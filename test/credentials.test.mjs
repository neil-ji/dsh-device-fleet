/**
 * Auto-credential resolution tests: the spark-link borrowing path and the
 * refuse-when-nothing-applies path.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFleetToken } from '../lib/credentials.js';

test('borrows spark-link pairing material when present', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'fleet-'));
	const statePath = join(dir, 'state.json');
	await writeFile(
		statePath,
		JSON.stringify({
			identity: { device_id: 'a', name: 'mac' },
			devices: {
				pc1: { device_id: 'b', name: 'HANSOMENEIL', enc: 'sRI1YsJ5l9dGLCD6hQx+qG+MoPIhviJNWe9jP6iRAT4=', sig: 'x' },
			},
		}),
	);
	const resolved = await resolveFleetToken(statePath);
	assert.ok(resolved !== null);
	assert.equal(resolved.token, 'sRI1YsJ5l9dGLCD6hQx+qG+MoPIhviJNWe9jP6iRAT4=');
	assert.match(resolved.source, /state\.json$/);
});

test('returns null when no state file or no usable entry exists', async () => {
	assert.equal(await resolveFleetToken(join(tmpdir(), 'fleet-missing', 'state.json')), null);
	const dir = await mkdtemp(join(tmpdir(), 'fleet-'));
	const statePath = join(dir, 'state.json');
	await writeFile(statePath, JSON.stringify({ identity: { device_id: 'a' }, devices: {} }));
	assert.equal(await resolveFleetToken(statePath), null);
});
