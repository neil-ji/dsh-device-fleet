/**
 * Ask forwarding — carry a worker-side question to the controller and bring the
 * answer back, so a delegated task is not stuck waiting for a human who is
 * sitting in front of the other machine.
 *
 * Kept as a pure function over an injected `fetch` so every branch (answer,
 * refusal, timeout, transport failure) is testable offline.
 *
 * @module dsh-device-fleet/ask-forward
 */

const DEFAULT_TIMEOUT_MS = 600_000;

/**
 * Forward one question request to a controller and wait for its answer.
 * @param {object} options Forwarding options.
 * @param {string} options.callbackUrl Controller base URL (as recorded at dispatch).
 * @param {string} options.token Token the controller will accept (this worker's own).
 * @param {unknown} options.request The `user-questions/request` payload.
 * @param {number} [options.timeoutMs] How long to wait for a human.
 * @param {string} [options.controllerSessionId] Controller session that should own the card.
 * @param {typeof fetch} [options.fetchImpl] Injected transport (tests).
 * @returns {Promise<unknown | null>} The answer, or null when forwarding is impossible.
 */
export async function forwardQuestion(options) {
	const { callbackUrl, token, request } = options;
	if (typeof callbackUrl !== 'string' || callbackUrl === '' || typeof token !== 'string' || token === '') return null;
	const questions = /** @type {{ questions?: unknown }} */ (request ?? {}).questions;
	if (!Array.isArray(questions) || questions.length === 0) return null;
	const doFetch = options.fetchImpl ?? fetch;
	const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
	let response;
	try {
		response = await doFetch(`${callbackUrl.replace(/\/+$/, '')}/fleet/ask`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
			body: JSON.stringify({ questions, ...(options.controllerSessionId ? { controllerSessionId: options.controllerSessionId } : {}) }),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch {
		// unreachable controller, timeout, or aborted: let the local surface answer
		return null;
	}
	if (!response.ok) return null;
	let body;
	try {
		body = await response.json();
	} catch {
		return null;
	}
	const answers = /** @type {{ answers?: unknown }} */ (body ?? {}).answers;
	if (!Array.isArray(answers) || answers.length === 0) return null;
	return { answers };
}
