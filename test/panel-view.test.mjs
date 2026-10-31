/**
 * The panel's task view: status vocabulary, ordering, and the read-only notice
 * count (showing notices must never consume the copy the agent is owed).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shapeFleetView } from '../lib/panel.js';
import { peekPendingNotices, appendPendingNotice, takePendingNotices } from '../lib/credentials.js';

test('tasks are newest first and carry a status the UI can render', () => {
	const now = 10_000_000;
	const view = shapeFleetView({
		now,
		dispatches: [
			{ sessionId: 'session-aaaaaaaa-1111', controllerSessionId: 'c1', device: 'PC', at: now - 1000, notified: false },
			{ sessionId: 'session-bbbbbbbb-2222', controllerSessionId: 'c1', device: 'PC', at: now - 9000, notified: true },
			{ sessionId: 'session-cccccccc-3333', controllerSessionId: 'c1', device: 'Mac', at: now - 40 * 60_000, notified: false },
		],
		notices: [],
	});
	assert.deepEqual(view.tasks.map((task) => task.status), ['running', 'done', 'stale']);
	assert.equal(view.tasks[0].shortId, 'aaa-1111');
	assert.equal(view.tasks[0].device, 'PC');
});

test('a completed task is recognised by its parked notice', () => {
	const now = 20_000_000;
	const view = shapeFleetView({
		now,
		dispatches: [{ sessionId: 'session-done-1', controllerSessionId: 'c', device: 'PC', at: now - 60_000, notified: false }],
		notices: [{ sessionId: 'session-done-1', device: 'PC', at: now - 30_000 }],
	});
	assert.equal(view.tasks[0].status, 'done', 'a pending notice is proof the task finished');
	assert.equal(view.noticeCount, 1);
});

test('an entry without a device name still renders', () => {
	const view = shapeFleetView({ now: 1000, dispatches: [{ sessionId: 's', controllerSessionId: 'c', at: 0, notified: false }], notices: [] });
	assert.equal(view.tasks[0].device, '未知设备');
});

test('the panel shows pending notices without consuming them', async () => {
	const controllerSessionId = 'session-panel-peek-test';
	const dir = await mkdtemp(join(tmpdir(), 'fleet-panel-peek-'));
	const store = join(dir, 'device-fleet.json');
	try {
		await appendPendingNotice({ controllerSessionId, sessionId: 'session-worker-one', device: 'PC' }, store);
		const peeked = await peekPendingNotices(store);
		assert.ok(peeked.some((notice) => notice.controllerSessionId === controllerSessionId), 'panel sees the notice');
		const stillThere = await peekPendingNotices(store);
		assert.ok(stillThere.some((notice) => notice.controllerSessionId === controllerSessionId), 'peeking does not consume');
		const taken = await takePendingNotices(controllerSessionId, store);
		assert.equal(taken.length, 1, 'the agent still receives it once');
	} finally {
		await takePendingNotices(controllerSessionId, store);
		await rm(dir, { recursive: true, force: true });
	}
});

test('the controller journal lists what this machine dispatched', async () => {
	const { noteControllerDispatch, listControllerTasks } = await import('../lib/registry.js');
	noteControllerDispatch('session-journal-1', 'Hansomeneil', 5_000);
	noteControllerDispatch('session-journal-2', 'Mac', 6_000);
	const tasks = listControllerTasks().filter((task) => task.sessionId.startsWith('session-journal-'));
	assert.deepEqual(tasks.map((task) => [task.device, task.at]), [['Hansomeneil', 5_000], ['Mac', 6_000]]);
});

test('a notice from an earlier dispatch or another device does not complete new work', () => {
	const entry = { sessionId: 'reused', device: 'PC-1', at: 2000 };
	for (const notice of [
		{ sessionId: 'reused', device: 'PC-1', at: 1000 },
		{ sessionId: 'reused', device: 'PC-2', at: 3000 },
	]) {
		const view = shapeFleetView({ now: 4000, dispatches: [entry], notices: [notice] });
		assert.equal(view.tasks[0].status, 'running');
	}
});

test('device-scoped merging preserves journal epoch and gets real session titles', async () => {
	const { mergeFleetEntries } = await import('../lib/panel.js');
	const merged = mergeFleetEntries(
		[{ sessionId: 'same', device: 'PC-1', at: 2000, notified: false }],
		[
			{ name: 'PC-1', entries: [{ sessionId: 'same', at: 1000, notified: true }], sessions: [{ sessionId: 'same', title: 'Build report' }] },
			{ name: 'PC-2', entries: [{ sessionId: 'same', at: 900, notified: true }], sessions: [] },
		],
	);
	assert.equal(merged.length, 2);
	assert.equal(merged[0].title, 'Build report');
	assert.equal(merged[0].at, 2000);
	assert.equal(merged[0].notified, false, 'old remote completion cannot complete a newer controller dispatch');
	assert.equal(merged[1].device, 'PC-2');
});

test('consuming notices does not regress a controller task to waiting', async () => {
	const { noteControllerDispatch, acceptCallbackOnce, listControllerTasks } = await import('../lib/registry.js');
	const id = 'session-ui-durable-completion';
	noteControllerDispatch(id, 'PC', 1000);
	acceptCallbackOnce(id, 600000, 2000);
	globalThis.__fleetState.lastAccepted.delete(id); // dedupe cache pruning must not erase task history
	let task = listControllerTasks().find((entry) => entry.sessionId === id);
	assert.equal(shapeFleetView({ now: 3000, dispatches: [task], notices: [] }).tasks[0].status, 'done');
	noteControllerDispatch(id, 'PC', 4000);
	task = listControllerTasks().find((entry) => entry.sessionId === id);
	assert.equal(shapeFleetView({ now: 5000, dispatches: [task], notices: [] }).tasks[0].status, 'running');
});

test('legacy journals recover device identity only from an unambiguous worker record', async () => {
	const { mergeFleetEntries } = await import('../lib/panel.js');
	const journal = [{ sessionId: 'legacy', device: '', at: 2000, notified: true }];
	const remote = {
		name: 'PC-1',
		entries: [{ sessionId: 'legacy', at: 1000, notified: false }],
		sessions: [{ sessionId: 'legacy', title: 'Existing task' }],
	};
	const merged = mergeFleetEntries(journal, [remote]);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].device, 'PC-1');
	assert.equal(merged[0].title, 'Existing task');
	assert.equal(merged[0].notified, true);
	const ambiguous = mergeFleetEntries(journal, [remote, { ...remote, name: 'PC-2' }]);
	assert.equal(ambiguous.length, 3);
	assert.equal(ambiguous[0].device, '未知设备');
});
