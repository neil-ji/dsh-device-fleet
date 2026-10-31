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

/**
 * Shared state lives on globalThis on purpose: HMR replaces modules and this one
 * is imported by both the plugin entry and the hot-swapped impls, so a plain
 * module-level Map can end up split in two — the worker records a dispatch in one
 * instance while the tool reads another (observed on the PC as "this session was
 * not started by a fleet dispatch" for a session that plainly was).
 *
 * @type {{
 *   dispatches: Map<string, { controllerSessionId: string, callbackUrl: string, title?: string, at: number, notified?: boolean }>,
 *   lastCallback: null | { sessionId: string, at: number, ok: boolean, woke?: boolean, error?: string },
 *   lastAsk: null | { sessionId: string, at: number, forwarded: boolean, answered: boolean },
 *   lastArm: null | { sessionId: string, at: number, armed: boolean, reason: string },
 *   questionProbe: null | { at: number, questions: number, ids: string[] },
 * }}
 */
const shared =
	globalThis.__fleetState ??
	(globalThis.__fleetState = {
		dispatches: new Map(),
		lastCallback: null,
		lastAsk: null,
		lastArm: null,
		questionProbe: null,
		lastAccepted: new Map(),
	});

const dispatches = shared.dispatches;

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
 * Undo markNotified when the delivery itself failed, so a later idle can retry.
 * @param {string} sessionId Worker-side session id.
 */
export function clearNotified(sessionId) {
	const entry = dispatches.get(String(sessionId));
	if (entry !== undefined) entry.notified = false;
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
	shared.lastCallback = { ...outcome, at: Date.now() };
}

/** @returns {null | { sessionId: string, at: number, ok: boolean, woke?: boolean, error?: string }} Last callback attempt. */
export function getLastCallback() {
	return shared.lastCallback;
}

/**
 * Probe record for the user-questions waterfall: proves whether a plugin-root
 * listener sees questions asked by worker-side sessions.
 * @param {unknown} request Question request payload.
 */
export function noteQuestionProbe(request) {
	const questions = Array.isArray(request?.questions) ? request.questions : [];
	shared.questionProbe = { at: Date.now(), questions: questions.length, ids: questions.map((q) => String(q?.id ?? '')) };
}

/** @returns {null | { at: number, questions: number, ids: string[] }} Last observed question. */
export function getQuestionProbe() {
	return shared.questionProbe;
}

/**
 * Record the last forwarded question, so a stuck relay is visible from the
 * diagnostics route instead of looking like a hung task.
 * @param {{ sessionId: string, forwarded: boolean, answered: boolean }} outcome Ask result.
 */
export function noteAsk(outcome) {
	shared.lastAsk = { ...outcome, at: Date.now() };
}

/** @returns {null | { sessionId: string, at: number, forwarded: boolean, answered: boolean }} Last forwarded ask. */
export function getLastAsk() {
	return shared.lastAsk;
}

/**
 * Record the last arm attempt for ask forwarding, with the reason it failed, so
 * "the listener never fired" is diagnosable rather than a guess.
 * @param {{ sessionId: string, armed: boolean, reason: string }} outcome Arm result.
 */
export function noteArm(outcome) {
	shared.lastArm = { ...outcome, at: Date.now() };
}

/** @returns {null | { sessionId: string, at: number, armed: boolean, reason: string }} Last arm attempt. */
export function getLastArm() {
	return shared.lastArm;
}

/**
 * Accept one completion callback per worker session within a window.
 *
 * The worker marks a dispatch notified before sending, but a session can be
 * dispatched to again (which resets that mark) and an idle transition can be
 * reported twice across a module reload. Deduplicating at the receiver makes the
 * wake idempotent regardless of what the sender does.
 * @param {string} sessionId Worker-side session id.
 * @param {number} [windowMs] Suppression window, default two minutes.
 * @param {number} [now] Injectable clock for tests.
 * @returns {boolean} True when this callback should be delivered.
 */
export function acceptCallbackOnce(sessionId, windowMs = 120_000, now = Date.now()) {
	const key = String(sessionId);
	const previous = shared.lastAccepted.get(key);
	if (previous !== undefined && now - previous < windowMs) return false;
	shared.lastAccepted.set(key, now);
	// keep the map from growing without bound
	if (shared.lastAccepted.size > 200) {
		for (const [id, at] of shared.lastAccepted) if (now - at > windowMs) shared.lastAccepted.delete(id);
	}
	return true;
}
