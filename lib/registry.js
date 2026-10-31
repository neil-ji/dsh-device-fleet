/**
 * Dispatch registry — the map that turns "a worker session went idle" into
 * "wake this controller session".
 *
 * Deliberately module-level and tiny: the worker half records an entry when it
 * accepts a fleet-dispatched prompt, and the Host event listener in index.js
 * reads it when the same session turns idle. Both halves must see the same
 * object, so this lives outside the hot-swappable impls.
 *
 * @module dsh-device-fleet/registry
 */

/** @type {Map<string, { controllerSessionId: string, callbackUrl: string, title?: string, at: number }>} */
const dispatches = new Map();

/**
 * Remember which controller session asked for a worker session's work.
 * @param {string} sessionId Worker-side session id.
 * @param {{ controllerSessionId: string, callbackUrl: string, title?: string }} entry Callback target.
 */
export function recordDispatch(sessionId, entry) {
	dispatches.set(String(sessionId), { ...entry, at: Date.now() });
}

/**
 * Look up the callback target for one worker session.
 * @param {string} sessionId Worker-side session id.
 * @returns {{ controllerSessionId: string, callbackUrl: string, title?: string, at: number } | undefined} Entry when the session was fleet-dispatched.
 */
export function getDispatch(sessionId) {
	return dispatches.get(String(sessionId));
}

/**
 * Drop one entry, used when a callback was delivered (a later idle also
 * notifies, because a session can run several turns for the same task).
 * @param {string} sessionId Worker-side session id.
 */
export function clearDispatch(sessionId) {
	dispatches.delete(String(sessionId));
}

/** @returns {string[]} Every session known to have been fleet-dispatched. */
export function listDispatches() {
	return [...dispatches.keys()];
}
