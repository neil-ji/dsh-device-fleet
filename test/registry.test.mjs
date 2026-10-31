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
