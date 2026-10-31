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

/** @type {null | { sessionId: string, at: number, ok: boolean, woke?: boolean, error?: string }} */
let lastCallback = null;

/**
 * Remember which controller session asked for a worker session's work.
 * @param {string} sessionId Worker-side session id.
 * @param {{ controllerSessionId: string, callbackUrl: string, title?: string }} entry Callback target.
 */
export function recordDispatch(sessionId, entry) {
	// Prune anything older than a day: a long-lived Host should not accumulate
	// callback targets for sessions nobody waits on any more.
	const cutoff = Date.now() - 24 * 60 * 60 * 1000;
	for (const [key, value] of dispatches) if (value.at < cutoff) dispatches.delete(key);
	dispatches.set(String(sessionId), { ...entry, at: Date.now(), notified: false });
}

/**
 * Whether this dispatch already produced its one completion notification.
 * @param {string} sessionId Worker-side session id.
 * @returns {boolean} True when a callback was already delivered for it.
 */
export function wasNotified(sessionId) {
	return dispatches.get(String(sessionId))?.notified === true;
}

/**
 * Mark the notification as delivered, so a session that idles again later does
 * not wake the controller a second time for the same dispatch.
 * @param {string} sessionId Worker-side session id.
 */
export function markNotified(sessionId) {
	const entry = dispatches.get(String(sessionId));
	if (entry !== undefined) entry.notified = true;
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

/**
 * Record the outcome of the most recent completion callback. Silent failures
 * here are invisible across machines, so the diagnostic route reports it.
 * @param {{ sessionId: string, ok: boolean, woke?: boolean, error?: string }} outcome Callback result.
 */
export function noteCallback(outcome) {
	lastCallback = { ...outcome, at: Date.now() };
}

/** @returns {null | { sessionId: string, at: number, ok: boolean, woke?: boolean, error?: string }} Last callback attempt. */
export function getLastCallback() {
	return lastCallback;
}
