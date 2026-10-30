/**
 * Worker-side LAN HTTP server.
 *
 * Exposes GUI-parity session operations of the LOCAL DSH Host to paired
 * controllers on the home LAN. Every handler is a thin adapter over the same
 * Host services the Web GUI's remote surface uses (`workspaceRegistry`,
 * `sessionController`), so semantics — including prompt queueing (`queue`)
 * and steering (`steer`) — are exactly what a person gets by hand.
 *
 * The listener is deliberately separate from the DSH web server: the GUI may
 * bind loopback only, and this API must not inherit (or weaken) browser
 * authentication. It carries its own Bearer token and refuses to start when
 * the token is empty.
 *
 * @module dsh-device-fleet/server
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_LIST_ITEMS = 200;

/**
 * Summarize one registered workspace for cross-machine consumption.
 * @param {unknown} workspace Registry entry.
 * @returns {Record<string, unknown>} Plain facts only.
 */
function shapeWorkspace(workspace) {
	const item = /** @type {Record<string, unknown>} */ (workspace ?? {});
	return {
		workspaceId: String(item.id ?? ''),
		title: item.title ?? null,
		path: item.path ?? null,
	};
}

/**
 * Summarize one session row; projection blocks are dropped except the few
 * fields a controller agent needs to decide reuse vs create.
 * @param {unknown} row `sessionController.list` item.
 * @returns {Record<string, unknown>} Plain facts only.
 */
function shapeSession(row) {
	const item = /** @type {Record<string, unknown>} */ (row ?? {});
	const projections = /** @type {{ values?: Record<string, unknown> }} */ (item.projections ?? {});
	const values = projections.values ?? {};
	const inbox = /** @type {{ 'next-turn'?: unknown[] } | undefined} */ (values.inbox);
	return {
		sessionId: String(item.sessionId ?? ''),
		title: values.title ?? null,
		running: item.running === true,
		blank: item.blank === true,
		cwd: item.cwd ?? values.workingDirectory ?? null,
		updatedAt: item.updatedAt ?? 0,
		agentAvailable: item.agentAvailable === true,
		queuedTurns: Array.isArray(inbox?.['next-turn']) ? inbox['next-turn'].length : 0,
	};
}

/**
 * Build the request router. Exported for tests: `services` mocks the two Host
 * services so the full HTTP surface can be exercised without a Host.
 * @param {object} services Host service implementations.
 * @param {string} services.deviceName Display name announced to controllers.
 * @param {unknown} services.workspaceRegistry DSH workspace registry.
 * @param {unknown} services.sessionController DSH session controller.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} Handler.
 */
export function createHandler(services) {
	/**
	 * Send one JSON response and close the request.
	 * @param {import('node:http').ServerResponse} res Response stream.
	 * @param {number} status HTTP status.
	 * @param {unknown} payload JSON body.
	 */
	function reply(res, status, payload) {
		const body = JSON.stringify(payload);
		res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
		res.end(body);
	}

	/**
	 * Read and parse a bounded JSON body.
	 * @param {import('node:http').IncomingMessage} req Request stream.
	 * @returns {Promise<Record<string, unknown>>} Parsed object; rejects on oversize or bad JSON.
	 */
	function readJson(req) {
		return new Promise((resolve, reject) => {
			const chunks = [];
			let size = 0;
			req.on('data', (chunk) => {
				size += chunk.length;
				if (size > MAX_BODY_BYTES) {
					reject(Object.assign(new Error('body too large'), { statusCode: 413 }));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on('end', () => {
				try {
					const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
					if (parsed === null || typeof parsed !== 'object') throw new Error('body must be a JSON object');
					resolve(parsed);
				} catch (error) {
					reject(Object.assign(error, { statusCode: 400 }));
				}
			});
			req.on('error', reject);
		});
	}

	/**
	 * Run one route; every unknown failure becomes a 500 with a message.
	 * @param {import('node:http').IncomingMessage} req Request.
	 * @param {import('node:http').ServerResponse} res Response.
	 * @param {string} method HTTP method.
	 * @param {string} path Path without query.
	 * @param {URL} url Parsed URL.
	 * @returns {Promise<void>}
	 */
	async function route(req, res, method, path, url) {
		if (method === 'GET' && path === '/fleet/ping') {
			reply(res, 200, { ok: true, app: 'dsh-device-fleet', device: services.deviceName, version: '0.1.0' });
			return;
		}
		if (method === 'GET' && path === '/fleet/workspaces') {
			const list = await /** @type {{ list: () => Promise<unknown[]> }} */ (services.workspaceRegistry).list();
			reply(res, 200, { items: (list ?? []).slice(0, MAX_LIST_ITEMS).map(shapeWorkspace) });
			return;
		}
		if (method === 'GET' && path === '/fleet/sessions') {
			const value = await /** @type {{ list: (request: unknown, signal?: AbortSignal) => Promise<{ items?: unknown[] }> }} */ (
				services.sessionController
			).list({}, undefined);
			reply(res, 200, { items: (value?.items ?? []).slice(0, MAX_LIST_ITEMS).map(shapeSession) });
			return;
		}
		if (method === 'POST' && path === '/fleet/create') {
			const body = await readJson(req);
			const request = {};
			if (typeof body.workspaceId === 'string' && body.workspaceId !== '') request.workspaceId = body.workspaceId;
			else if (typeof body.cwd === 'string' && body.cwd !== '') request.cwd = body.cwd;
			else throw Object.assign(new Error('workspaceId or cwd is required'), { statusCode: 400 });
			if (typeof body.agentPreset === 'string' && body.agentPreset !== '') request.agentPreset = body.agentPreset;
			const value = await /** @type {{ create: (request: unknown) => Promise<{ sessionId: string }> }} */ (
				services.sessionController
			).create(request);
			reply(res, 200, { sessionId: String(value.sessionId) });
			return;
		}
		if (method === 'POST' && path === '/fleet/prompt') {
			const body = await readJson(req);
			const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
			const text = typeof body.text === 'string' ? body.text : '';
			if (sessionId === '' || text.trim() === '') {
				throw Object.assign(new Error('sessionId and non-empty text are required'), { statusCode: 400 });
			}
			const mode = body.mode === 'steer' ? 'steer' : 'queue';
			let timeZone = 'UTC';
			try {
				timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
			} catch {}
			await /** @type {{ prompt: (request: unknown) => Promise<unknown> }} */ (services.sessionController).prompt({
				requestId: typeof body.requestId === 'string' && body.requestId !== '' ? body.requestId : randomUUID(),
				sessionId,
				mode,
				content: [{ type: 'text', text }],
				clientTimeZone: timeZone,
			});
			reply(res, 200, { accepted: true, mode });
			return;
		}
		if (method === 'POST' && path === '/fleet/queue') {
			const body = await readJson(req);
			const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
			const itemId = typeof body.itemId === 'string' ? body.itemId : '';
			const action = body.action;
			if (sessionId === '' || itemId === '' || action === null || typeof action !== 'object') {
				throw Object.assign(new Error('sessionId, itemId and action are required'), { statusCode: 400 });
			}
			await /** @type {{ updateQueue: (request: unknown) => Promise<unknown> }} */ (services.sessionController).updateQueue({
				sessionId,
				itemId,
				action,
			});
			reply(res, 200, { accepted: true });
			return;
		}
		if (method === 'POST' && path === '/fleet/cancel') {
			const body = await readJson(req);
			const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
			if (sessionId === '') throw Object.assign(new Error('sessionId is required'), { statusCode: 400 });
			await /** @type {{ cancel: (request: unknown) => Promise<unknown> }} */ (services.sessionController).cancel({ sessionId });
			reply(res, 200, { accepted: true });
			return;
		}
		if (method === 'GET' && path === '/fleet/status') {
			const sessionId = url.searchParams.get('sessionId') ?? '';
			const value = await /** @type {{ list: (request: unknown, signal?: AbortSignal) => Promise<{ items?: unknown[] }> }} */ (
				services.sessionController
			).list({}, undefined);
			const items = (value?.items ?? []).map(shapeSession);
			if (sessionId === '') {
				reply(res, 200, { items: items.slice(0, MAX_LIST_ITEMS) });
				return;
			}
			const found = items.find((item) => item.sessionId === sessionId);
			if (found === undefined) throw Object.assign(new Error('unknown session'), { statusCode: 404 });
			reply(res, 200, found);
			return;
		}
		throw Object.assign(new Error('not found'), { statusCode: 404 });
	}

	return async function handle(req, res) {
		const url = new URL(req.url ?? '/', 'http://localhost');
		const method = (req.method ?? 'GET').toUpperCase();
		try {
			await route(req, res, method, url.pathname, url);
		} catch (error) {
			const status = typeof error?.statusCode === 'number' ? error.statusCode : 500;
			reply(res, status, { error: error instanceof Error ? error.message : String(error) });
		}
	};
}

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
 * @returns {Promise<{ close: () => Promise<void>, port: number }>} Running server handle.
 */
export async function startWorkerServer(options) {
	const token = typeof options.token === 'string' ? options.token : '';
	if (token === '') {
		throw new Error('device-fleet worker requires a non-empty token in its config; refusing to expose sessions without one');
	}
	const handle = createHandler({
		deviceName: options.deviceName,
		workspaceRegistry: options.workspaceRegistry,
		sessionController: options.sessionController,
	});
	const server = createServer((req, res) => {
		const expected = `Bearer ${token}`;
		if ((req.headers.authorization ?? '') !== expected) {
			res.writeHead(401, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ error: 'unauthorized' }));
			return;
		}
		handle(req, res).catch(() => {});
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
