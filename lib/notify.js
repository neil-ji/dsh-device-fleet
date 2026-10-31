/**
 * Where a machine event is allowed to go.
 *
 * A worker completing a task is data, not an instruction from the person using
 * this machine. Pushing it into the chat as a user message makes it share the
 * commander's authority *and* steals a turn boundary, so the default is to park
 * it in the notice store and let the agent read it when the human is present.
 *
 * @module dsh-device-fleet/notify
 */

/**
 * Decide how one completion is delivered.
 * @param {{ mode?: string, agentLive?: boolean }} options Delivery context.
 * @returns {'prompt' | 'store'} `prompt` writes into the chat (opt-in), `store` parks it.
 */
export function decideDelivery(options) {
	const mode = options?.mode === 'chat' ? 'chat' : 'panel';
	if (mode !== 'chat') return 'store';
	return options?.agentLive === true ? 'prompt' : 'store';
}
