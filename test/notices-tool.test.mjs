/**
 * fleet_notices reads the parked completions; without a controller session it
 * must answer empty instead of throwing (the tool is also exposed on workers).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { handlers } from '../lib/controller-impl.js';

const config = { role: 'worker+controller', port: 48791, token: 't', controllerPort: 48791, workers: [], notify: 'panel', exec: { mode: 'off', allow: [] } };

test('without a session id it returns an empty list', async () => {
	const map = handlers(config, {});
	const result = await map.fleet_notices({}, { agentId: '' });
	assert.deepEqual(result, { count: 0, notices: [] });
});

test('a session with nothing parked gets an empty list, not an error', async () => {
	const map = handlers(config, {});
	const result = await map.fleet_notices({}, { agentId: 'session-no-notices-0000' });
	assert.equal(result.count, 0);
	assert.deepEqual(result.notices, []);
});
