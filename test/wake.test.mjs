/**
 * Silent wake: policy selection, and the guarantee that it never writes a user
 * message. The last test pins the transport calls, because the whole point is
 * that the wake is invisible to the human and carries no payload.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { planWake, wakeSilently } from '../lib/wake.js';

test('the default is a silent wake when the transport allows it', () => {
	assert.equal(planWake({ wake: 'silent', agentLive: true, agentHasInject: true }), 'silent');
	assert.equal(planWake({ agentLive: true, agentHasInject: true }), 'silent');
});

test('every degraded case falls back rather than waking nothing', () => {
	assert.equal(planWake({ wake: 'off', agentLive: true, agentHasInject: true }), 'store');
	assert.equal(planWake({ wake: 'silent', agentLive: false, agentHasInject: true }), 'store');
	assert.equal(planWake({ wake: 'silent', agentLive: true, agentHasInject: false }), 'thread');
	assert.equal(planWake({ wake: 'thread', agentLive: true, agentHasInject: true }), 'thread');
});

test('a silent wake injects runtime-context and calls wakeDriver, nothing else', () => {
	const calls = [];
	const agent = {
		inject: (message) => calls.push(['inject', message]),
		wakeDriver: () => calls.push(['wakeDriver']),
		followup: () => calls.push(['followup']),
		steer: () => calls.push(['steer']),
	};
	const result = wakeSilently(agent);
	assert.deepEqual(result, { woke: true });
	assert.deepEqual(calls.map(([name]) => name), ['inject', 'wakeDriver'], 'never followup/steer: those create user messages');
	const injected = calls[0][1];
	assert.equal(injected.source.kind, 'runtime-context', 'a plain user source would become a visible user message');
	assert.equal(injected.role, 'user');
});

test('a missing agent or transport reports why instead of throwing', () => {
	assert.equal(wakeSilently(undefined).woke, false);
	assert.equal(wakeSilently({}).woke, false);
	const boom = { inject() { throw new Error('nope'); }, wakeDriver() {} };
	assert.deepEqual(wakeSilently(boom), { woke: false, reason: 'nope' });
});
