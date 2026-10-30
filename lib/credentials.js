/**
 * Automatic fleet credential resolution.
 *
 * The preferred token costs zero configuration: spark-link is already paired
 * between the fleet machines and both ends store the SAME derived key
 * material for a pairing (HKDF with a shared secret), so its base64 `enc`
 * field for any paired peer is a usable shared Bearer secret. Nothing
 * sensitive leaves either machine; the token only rides the Authorization
 * header, exactly like a hand-configured one would.
 *
 * Fallback order: explicit config token → spark-link pairing material →
 * refuse (a LAN endpoint that exposes sessions must not run unauthenticated).
 *
 * @module dsh-device-fleet/credentials
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Read the spark-link pairing material to borrow as the fleet token.
 * @param {string} [statePath] Override the state file location (tests).
 * @returns {Promise<{ token: string, source: string } | null>} Resolved token or null when no source applies.
 */
export async function resolveFleetToken(statePath) {
	const path = statePath ?? join(homedir(), '.spark-link', 'state.json');
	let state;
	try {
		state = JSON.parse(await readFile(path, 'utf8'));
	} catch {
		return null;
	}
	const devices = state?.devices;
	if (devices === null || typeof devices !== 'object') return null;
	for (const entry of Object.values(devices)) {
		const secret = entry?.enc;
		if (typeof secret === 'string' && secret.length >= 32) {
			return { token: secret, source: `spark-link:${path}` };
		}
	}
	return null;
}

/**
 * Paired spark-link peers as fleet worker candidates: the same machines are
 * already paired, and `last_addr` gives a LAN host even when multicast is
 * being filtered by the AP (common on home Wi-Fi). Only the host is reused;
 * the fleet port is the plugin's own default.
 * @param {string} [statePath] Override the state file location (tests).
 * @param {number} [port] Fleet port to pair with each peer host.
 * @returns {Promise<Array<{ name: string, url: string }>>} Candidate workers.
 */
export async function resolveFleetPeers(statePath, port = 48791) {
	const path = statePath ?? join(homedir(), '.spark-link', 'state.json');
	let state;
	try {
		state = JSON.parse(await readFile(path, 'utf8'));
	} catch {
		return [];
	}
	const devices = state?.devices;
	if (devices === null || typeof devices !== 'object') return [];
	const peers = [];
	for (const entry of Object.values(devices)) {
		const item = /** @type {Record<string, unknown>} */ (entry ?? {});
		const name = typeof item.name === 'string' ? item.name : '';
		const lastAddr = typeof item.last_addr === 'string' ? item.last_addr : '';
		const host = lastAddr.split(':')[0];
		if (name !== '' && host !== '') peers.push({ name, url: `http://${host}:${port}` });
	}
	return peers;
}
