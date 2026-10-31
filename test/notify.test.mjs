/**
 * Delivery routing. The default must never write a machine event into the chat:
 * that is what interrupted a live conversation and let a worker's message look
 * like the commander's.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { decideDelivery } from '../lib/notify.js';

test('default (panel) always parks the notice, even with a live agent', () => {
	assert.equal(decideDelivery({ mode: 'panel', agentLive: true }), 'store');
	assert.equal(decideDelivery({ agentLive: true }), 'store');
	assert.equal(decideDelivery({ mode: undefined, agentLive: true }), 'store');
});

test('chat mode is opt-in and still stores when no agent is live', () => {
	assert.equal(decideDelivery({ mode: 'chat', agentLive: true }), 'prompt');
	assert.equal(decideDelivery({ mode: 'chat', agentLive: false }), 'store');
});
