/**
 * Wake a session without writing a user message.
 *
 * Measured on this platform: an inbox injection plus `wakeDriver()` opens a turn
 * and leaves no `user/message` in the transcript, but the injected content never
 * reaches the model (a message whose source kind is `runtime-context` is merged
 * into runtime context, not appended, so the turn arrives empty). Delivering
 * content and staying invisible are therefore mutually exclusive.
 *
 * The fleet takes invisibility: the wake carries no payload, and the agent pulls
 * the notice itself through `fleet_notices`. That keeps the human's thread free
 * of machine-authored user messages while the agent still continues on its own.
 *
 * @module dsh-device-fleet/wake
 */

/**
 * Choose how one completion may reach its controller session.
 * @param {{ wake?: string, agentLive?: boolean, agentHasInject?: boolean }} options Capabilities and policy.
 * @returns {'silent' | 'thread' | 'store'} Delivery decision.
 */
export function planWake(options) {
	const wake = options?.wake === 'thread' || options?.wake === 'off' ? options.wake : 'silent';
	if (wake === 'off') return 'store';
	if (options?.agentLive !== true) return 'store';
	if (wake === 'thread') return 'thread';
	return options?.agentHasInject === true ? 'silent' : 'thread';
}

/**
 * Wake one agent through its inbox, carrying no payload.
 * @param {any} agent Live Agent.
 * @returns {{ woke: boolean, reason?: string }} Outcome.
 */
export function wakeSilently(agent) {
	if (agent === undefined || agent === null) return { woke: false, reason: 'agent-not-live' };
	if (typeof agent.inject !== 'function' || typeof agent.wakeDriver !== 'function') {
		return { woke: false, reason: 'transport-unavailable' };
	}
	try {
		agent.inject({
			id: `msg-${crypto.randomUUID()}`,
			role: 'user',
			// Merged into runtime context instead of appended: no user/message event,
			// and therefore nothing for a human to mistake for their own words.
			content: [{ type: 'text', text: '' }],
			source: { kind: 'runtime-context' },
		});
		agent.wakeDriver();
		return { woke: true };
	} catch (error) {
		return { woke: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * Whether a newly appearing session should be woken.
 *
 * Only a session that actually has a parked completion may be woken: waking one
 * that has nothing to read hands the agent an empty turn, and it fills that
 * silence by talking to nobody (observed as a self-introduction in a brand-new
 * session before the user typed anything).
 * @param {{ wake?: string, hasNotices?: boolean }} options Policy and state.
 * @returns {boolean} True when a wake is warranted.
 */
export function shouldWakeOnArrival(options) {
	if (options?.hasNotices !== true) return false;
	return options?.wake !== 'off';
}
