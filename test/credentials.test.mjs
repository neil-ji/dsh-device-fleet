/**
 * Plugin-native identity tests: worker token generation/persistence, claim
 * lifecycle, and controller-side pinning. No external state files involved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureWorkerToken, isClaimable, markClaimed, pinPeer, pinnedPeers, readStore, STORE_PATH } from '../lib/credentials.js';

async function tempStore() {
	const dir = await mkdtemp(join(tmpdir(), 'fleet-'));
	return join(dir, 'device-fleet.json');
}

test('worker token is generated once and stable across reads', async () => {
	const store = await tempStore();
	const first = await ensureWorkerToken(store);
	const again = await ensureWorkerToken(store);
	assert.equal(first, again);
	assert.ok(first.length >= 40);
	const persisted = await readStore(store);
	assert.equal(persisted.workerToken, first);
});

test('claim lifecycle: claimable until marked, then not', async () => {
	const store = await tempStore();
	assert.equal(await isClaimable(store), true);
	await markClaimed('mac', store);
	assert.equal(await isClaimable(store), false);
	const persisted = await readStore(store);
	assert.equal(persisted.claimedBy, 'mac');
});

test('controller pinning round-trips peers', async () => {
	const store = await tempStore();
	await pinPeer('HANSOMENEIL', 'http://192.168.1.74:48791', 'tok-1', store);
	await pinPeer('HANSOMENEIL', 'http://192.168.1.74:48791', 'tok-2', store);
	const peers = await pinnedPeers(store);
	assert.deepEqual(peers, { HANSOMENEIL: { url: 'http://192.168.1.74:48791', token: 'tok-2' } });
});

test('default store path lives under the DSH home, plugin-owned', async () => {
	assert.ok(STORE_PATH.includes('.dsh'));
	assert.ok(STORE_PATH.endsWith('device-fleet.json'));
});
