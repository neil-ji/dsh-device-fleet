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
