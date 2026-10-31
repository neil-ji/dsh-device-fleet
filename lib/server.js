/**
 * dsh-device-fleet worker — the stable socket shell.
 *
 * This module owns only what must survive across updates: the listener, the
 * Bearer gate, and the TOFU exemptions. Everything that evolves (routes,
 * shaping, service wiring) lives in `worker-impl.js` and is hot-loaded per
 * request through `lib/hot.js`, so a `git pull` swaps the running handler on
 * the next request without any process restart.
 *
 * @module dsh-device-fleet/server
 */

import { createServer } from 'node:http';
import { hotImporter } from './hot.js';

/** Worker requests always run against the freshest impl generation. */
const loadImpl = hotImporter(import.meta.url, ['worker-impl.js']);

/**
 * Start the LAN listener. Resolves once the socket accepts; rejects when the
 * port is taken so the caller can report a precise failure.
 * @param {object} options Server options.
 * @param {string} options.host Bind address; loopback only makes sense for tests.
 * @param {number} options.port TCP port.
 * @param {string} options.token Bearer token; empty refuses to start.
 * @param {string} options.deviceName Display name returned by ping.
 * @param {unknown} options.workspaceRegistry Host workspace registry.
 * @param {unknown} options.sessionController Host session controller.
 * @param {unknown} [options.sessionQuery] Host session query service.
 * @param {{ isClaimable: () => Promise<boolean>, discloseToken: () => Promise<string>, claim: (name: string) => Promise<void> }} [options.pairing] TOFU pairing hooks exposed on /fleet/hello and /fleet/claim.
 * @returns {Promise<{ close: () => Promise<void>, port: number }>} Running server handle.
 */
export async function startWorkerServer(options) {
	const token = typeof options.token === 'string' ? options.token : '';
	if (token === '') {
		throw new Error('device-fleet worker requires a non-empty token in its config; refusing to expose sessions without one');
	}
	const services = {
		deviceName: options.deviceName,
		workspaceRegistry: options.workspaceRegistry,
		sessionController: options.sessionController,
		sessionQuery: options.sessionQuery,
		pairing: options.pairing,
		onCallback: options.onCallback,
		armSession: options.armSession,
		onAsk: options.onAsk,
	};
	const server = createServer((req, res) => {
		const expected = `Bearer ${token}`;
		const path = req.url?.split('?')[0] ?? '';
		const presented = req.headers.authorization ?? '';
		// `/fleet/hello` IS the pairing bootstrap, so it stays unauthenticated
		// (it only discloses the token while the worker is unclaimed); a claim
		// from an already-tokened controller rides the normal gate.
		const unauthenticated =
			(req.method === 'GET' && path === '/fleet/hello') ||
			(req.method === 'POST' && path === '/fleet/claim' && presented === expected);
		// A completion callback is sent BY a paired worker, which never learns
		// this listener's own token: it authenticates with the token this side
		// pinned for that worker at pairing time. Anything else still needs the
		// local token.
		const admit = async () => {
			if (presented === expected) return true;
			if (path !== '/fleet/callback' && path !== '/fleet/ask') return false;
			const peerTokens = typeof options.verifyPeerToken === 'function' ? await options.verifyPeerToken(presented) : false;
			return peerTokens === true;
		};
		if (!unauthenticated) {
			admit().then((ok) => {
				if (!ok) {
					res.writeHead(401, { 'content-type': 'application/json' });
					res.end(JSON.stringify({ error: 'unauthorized' }));
					return;
				}
				loadImpl()
					.then((impl) => impl.createHandler(services)(req, res))
					.catch((error) => {
						res.writeHead(500, { 'content-type': 'application/json' });
						res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
					});
			});
			return;
		}
		loadImpl()
			.then((impl) => impl.createHandler(services)(req, res))
			.catch((error) => {
				res.writeHead(500, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
			});
	});
	server.on('requestTimeout', () => {});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(options.port, options.host, () => resolve(undefined));
	});
	const address = server.address();
	const boundPort = typeof address === 'object' && address !== null ? address.port : options.port;
	return {
		port: boundPort,
		close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
	};
}
