/**
 * Fleet identity and pairing, entirely plugin-owned.
 *
 * Zero external dependencies: no borrowed secrets, no third-party state
 * files. The worker generates a random token on first activation and keeps
 * it in the plugin's own store. A controller pairs by trust-on-first-use:
 * the worker hands out its token over the LAN only until the first
 * controller claims it; afterwards the token is pinned on both sides and
 * `hello` stops disclosing. On a trusted home LAN this gives zero-config
 * pairing with a first-claimant trust root; set `config.token` explicitly
 * to opt out of TOFU entirely.
 *
 * Store location is the plugin's own file under the DSH home directory:
 * `~/.dsh/device-fleet.json` (worker token, claim state, pinned peers).
 *
 * @module dsh-device-fleet/credentials
 */

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Plugin-owned store under the DSH home directory. */
export const STORE_PATH = join(homedir(), '.dsh', 'device-fleet.json');

/**
 * Read the whole store; missing or malformed file means empty store.
 * @param {string} [path] Override the store location (tests).
 * @returns {Promise<{ workerToken?: string, claimed?: boolean, peers?: Record<string, { url: string, token: string }> }>} Store contents.
 */
export async function readStore(path = STORE_PATH) {
	try {
		const parsed = JSON.parse(await readFile(path, 'utf8'));
		return parsed !== null && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * Atomically merge one patch into the store (tmp + rename, 0600 file).
 * @param {(current: Record<string, unknown>) => Record<string, unknown>} mutate Pure mutation over the current store.
 * @param {string} [path] Override the store location (tests).
 */
export async function updateStore(mutate, path = STORE_PATH) {
	const next = mutate(await readStore(path));
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
	await writeFile(tmp, JSON.stringify(next, null, 1), { mode: 0o600 });
	await rename(tmp, path);
}

/**
 * The worker's token, generated on first use and stable afterwards.
 * @param {string} [path] Override the store location (tests).
 * @returns {Promise<string>} Persisted random Bearer token.
 */
export async function ensureWorkerToken(path = STORE_PATH) {
	const store = await readStore(path);
	if (typeof store.workerToken === 'string' && store.workerToken !== '') return store.workerToken;
	const token = randomBytes(32).toString('base64');
	await updateStore((current) => ({ ...current, workerToken: token }), path);
	return token;
}

/**
 * Whether the worker still discloses its token to unpaired controllers.
 * @param {string} [path] Override the store location (tests).
 * @returns {Promise<boolean>} True while the token is still claimable.
 */
export async function isClaimable(path = STORE_PATH) {
	const store = await readStore(path);
	return store.claimed !== true;
}

/**
 * Mark the worker claimed by its first controller; the token stops being
 * disclosed by `hello` from now on.
 * @param {string} controllerName Human-readable identity of the claiming controller.
 * @param {string} [path] Override the store location (tests).
 */
export async function markClaimed(controllerName, path = STORE_PATH) {
	await updateStore((current) => ({ ...current, claimed: true, claimedBy: controllerName }), path);
}

/**
 * Pin one paired worker on the controller side.
 * @param {string} name Worker name used in tool calls.
 * @param {string} url Worker base URL.
 * @param {string} token Pinned Bearer token.
 * @param {string} [path] Override the store location (tests).
 */
export async function pinPeer(name, url, token, path = STORE_PATH) {
	await updateStore((current) => {
		const peers = { ...(current.peers ?? {}), [name]: { url, token } };
		return { ...current, peers };
	}, path);
}

/**
 * Pinned workers known to this controller.
 * @param {string} [path] Override the store location (tests).
 * @returns {Promise<Record<string, { url: string, token: string }>>} Pinned peers keyed by name.
 */
export async function pinnedPeers(path = STORE_PATH) {
	const store = await readStore(path);
	const peers = store.peers;
	return peers !== null && typeof peers === 'object' ? peers : {};
}
