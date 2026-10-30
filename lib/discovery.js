/**
 * Fleet auto-discovery over one UDP multicast group.
 *
 * Workers announce `{t, id, device, url, ver}` periodically and on query;
 * controllers send a query and collect announces for a short window, and
 * workers answer a query by unicast to its source (multicast delivery is
 * unreliable on home Wi-Fi). Announces carry no secret — they only advertise
 * an endpoint the controller still needs a token for, which `lib/credentials.js`
 * resolves through plugin-native TOFU pairing.
 *
 * @module dsh-device-fleet/discovery
 */

import { createSocket } from 'node:dgram';
import { networkInterfaces, hostname } from 'node:os';

export const FLEET_GROUP = '239.255.77.79';
export const FLEET_UDP_PORT = 48792;
const ANNOUNCE_MS = 20_000;

/**
 * First non-internal IPv4 address of this machine.
 * @returns {string} LAN address or `127.0.0.1`.
 */
export function primaryLanAddress() {
	for (const list of Object.values(networkInterfaces())) {
		for (const net of list ?? []) {
			if (net.family === 'IPv4' && !net.internal) return net.address;
		}
	}
	return '127.0.0.1';
}

/**
 * Bind one multicast socket shared by both roles.
 * @param {(message: object, remote: { address: string }) => void} onMessage Parsed announce callback.
 * @returns {Promise<{ socket: import('node:dgram').Socket, send: (payload: object) => void, close: () => Promise<void> }>} Bound socket helpers.
 */
async function bind(onMessage) {
	const socket = createSocket({ type: 'udp4', reuseAddr: true });
	// A late multicast error (interface flap, ENETUNREACH while roaming) must
	// not surface as an uncaught exception inside the Host process.
	socket.on('error', () => {});
	socket.on('message', (data, remote) => {
		try {
			const parsed = JSON.parse(data.toString('utf8'));
			if (parsed !== null && typeof parsed === 'object' && typeof parsed.t === 'string') onMessage(parsed, remote);
		} catch {
			// foreign or malformed multicast traffic; ignore
		}
	});
	await new Promise((resolve, reject) => {
		socket.once('error', reject);
		socket.bind(FLEET_UDP_PORT, () => {
			try {
				socket.addMembership(FLEET_GROUP);
			} catch {
				// no multicast route right now; unicast query/reply still works
			}
			resolve(undefined);
		});
	});
	return {
		socket,
		send(payload, remote) {
			const data = Buffer.from(JSON.stringify(payload));
			if (remote !== undefined) socket.send(data, remote.port, remote.address);
			else socket.send(data, FLEET_UDP_PORT, FLEET_GROUP);
		},
		close: () => new Promise((resolve) => socket.close(() => resolve(undefined))),
	};
}

/**
 * Start periodic announcing for a worker. Returns a disposer for `ctx.effect`.
 * @param {object} options Announcer options.
 * @param {number} options.port TCP port the worker serves.
 * @param {string} options.deviceName Device display name.
 * @returns {Promise<() => Promise<void>>} Disposer.
 */
export async function startAnnouncing(options) {
	const url = `http://${primaryLanAddress()}:${options.port}`;
	const id = hostname() || 'dsh-worker';
	let timer = null;
	const channel = await bind((message, remote) => {
		if (message.t === 'fleet-query') channel.send(announce(), remote);
	});
	const announce = () => ({ t: 'fleet-announce', id, device: options.deviceName, url, ver: '0.1.0' });
	channel.send(announce());
	timer = setInterval(() => channel.send(announce()), ANNOUNCE_MS);
	timer.unref?.();
	return async () => {
		if (timer !== null) clearInterval(timer);
		await channel.close();
	};
}

/**
 * Discover workers on the LAN by listening for announces.
 * @param {number} [windowMs] How long to listen; queries once at the start.
 * @returns {Promise<Array<{ name: string, url: string, device: string }>>} Discovered workers, deduplicated by id.
 */
export async function discoverWorkers(windowMs = 4_000) {
	const found = new Map();
	const channel = await bind((message) => {
		if (message.t !== 'fleet-announce') return;
		if (typeof message.url !== 'string' || typeof message.id !== 'string') return;
		if (!found.has(message.id)) {
			found.set(message.id, { name: message.id, url: message.url, device: String(message.device ?? message.id) });
		}
	});
	channel.send({ t: 'fleet-query', id: hostname() || 'controller' });
	await new Promise((resolve) => setTimeout(resolve, windowMs));
	await channel.close();
	return [...found.values()];
}
