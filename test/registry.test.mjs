/**
 * The registry must behave as one object even when HMR gives two module
 * instances: the worker records dispatches through the hot-loaded impl while the
 * tool (entry module) reads them. A plain module-level Map split those in two and
 * produced "this session was not started by a fleet dispatch" for sessions that
 * plainly were.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

test('two module instances share the same dispatch state', async () => {
	const first = await import('../lib/registry.js');
	const second = await import('../lib/registry.js?v=hmr-second-instance');
	assert.notEqual(first, second, 'the query string produced a distinct module instance');

	first.recordDispatch('session-split', { controllerSessionId: 'controller-1', callbackUrl: 'http://127.0.0.1:48791' });
	assert.equal(second.getDispatch('session-split')?.controllerSessionId, 'controller-1');
	assert.deepEqual(second.listDispatches(), ['session-split']);

	second.markNotified('session-split');
	assert.equal(first.wasNotified('session-split'), true, 'notify state is shared too');

	second.clearNotified('session-split');
	assert.equal(first.wasNotified('session-split'), false);
});

test('completion callbacks are idempotent at the receiver', async () => {
	const { acceptCallbackOnce } = await import('../lib/registry.js');
	const t0 = 1_000_000;
	assert.equal(acceptCallbackOnce('session-dedupe', 120_000, t0), true, 'first callback accepted');
	assert.equal(acceptCallbackOnce('session-dedupe', 120_000, t0 + 1_000), false, 'immediate repeat suppressed');
	assert.equal(acceptCallbackOnce('session-dedupe', 120_000, t0 + 119_000), false, 'still inside the window');
	assert.equal(acceptCallbackOnce('session-dedupe', 120_000, t0 + 121_000), true, 'a later completion is delivered again');
	assert.equal(acceptCallbackOnce('another-session', 120_000, t0 + 2_000), true, 'other sessions are unaffected');
});

test('a new dispatch re-arms the wake, a stale repeat stays suppressed', async () => {
	const { acceptCallbackOnce, noteControllerDispatch } = await import('../lib/registry.js');
	const t0 = 2_000_000;
	assert.equal(acceptCallbackOnce('session-gen', 600_000, t0), true);
	// same completion reported again, no new dispatch: suppressed for the window
	assert.equal(acceptCallbackOnce('session-gen', 600_000, t0 + 300_000), false);
	// controller dispatches new work, so the next completion must be delivered
	noteControllerDispatch('session-gen', t0 + 400_000);
	assert.equal(acceptCallbackOnce('session-gen', 600_000, t0 + 401_000), true);
	// and its own repeat is suppressed again
	assert.equal(acceptCallbackOnce('session-gen', 600_000, t0 + 402_000), false);
});
