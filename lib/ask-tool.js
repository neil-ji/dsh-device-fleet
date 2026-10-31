/**
 * The worker-side `fleet_ask_human` tool: an explicit way for a delegated agent
 * to reach the controller's human.
 *
 * Intercepting the platform's own `ask_user_question` was abandoned on purpose:
 * `user-questions/request` is dispatched through an Agent-scoped waterfall whose
 * scope identity a plugin cannot reliably reconstruct (measured: a listener on
 * `agent.ctx` is registered but never fires). A dedicated tool needs no
 * interception, is visible to the model, and degrades loudly.
 *
 * @module dsh-device-fleet/ask-tool
 */

import { forwardQuestion } from './ask-forward.js';

/**
 * Build the tool result for one forwarded question.
 * @param {unknown | null} answer Answer returned by the controller, or null.
 * @returns {{ status: string, answers?: Array<{ id: string, selected: string[], custom?: string }>, message: string }} Tool output.
 */
export function shapeAskResult(answer) {
	const answers = /** @type {{ answers?: unknown }} */ (answer ?? {}).answers;
	if (!Array.isArray(answers) || answers.length === 0) {
		return {
			status: 'unavailable',
			message:
				'Nobody answered from the controller side (it may be offline, or the person declined). Do not guess: ' +
				'report the question in your final answer and stop, or retry once later.',
		};
	}
	return {
		status: 'answered',
		answers: answers.map((entry) => {
			const item = /** @type {Record<string, unknown>} */ (entry ?? {});
			return {
				id: String(item.id ?? ''),
				selected: Array.isArray(item.selected) ? item.selected.map(String) : [],
				...(typeof item.custom === 'string' && item.custom !== '' ? { custom: item.custom } : {}),
			};
		}),
		message: 'The person on the controller side answered. Continue with that answer.',
	};
}

/**
 * Ask the controller's human one question and wait for the answer.
 * @param {object} options Ask options.
 * @param {{ callbackUrl: string } | undefined} options.dispatch Recorded dispatch target.
 * @param {string} options.token Token the controller accepts (this worker's own).
 * @param {{ id?: string, question: string, options?: Array<{ label: string, description?: string }> }} options.question Question to ask.
 * @param {typeof fetch} [options.fetchImpl] Injected transport (tests).
 * @returns {Promise<ReturnType<typeof shapeAskResult>>} Tool output.
 */
export async function askHuman(options) {
	if (options.dispatch === undefined) {
		return {
			status: 'unavailable',
			message: 'This session was not started by a fleet dispatch, so there is no controller to ask.',
		};
	}
	const request = {
		questions: [
			{
				id: options.question.id ?? 'fleet-question',
				question: options.question.question,
				...(Array.isArray(options.question.options) && options.question.options.length > 0
					? { options: options.question.options }
					: {}),
			},
		],
	};
	const answer = await forwardQuestion({
		callbackUrl: options.dispatch.callbackUrl,
		token: options.token,
		request,
		...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
	});
	return shapeAskResult(answer);
}
