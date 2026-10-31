/**
 * The panel's task view: status vocabulary, ordering, and the read-only notice
 * count (showing notices must never consume the copy the agent is owed).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
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
	await appendPendingNotice({ controllerSessionId, sessionId: 'session-worker-one', device: 'PC' });
	try {
		const peeked = await peekPendingNotices();
		assert.ok(peeked.some((notice) => notice.controllerSessionId === controllerSessionId), 'panel sees the notice');
		const stillThere = await peekPendingNotices();
		assert.ok(stillThere.some((notice) => notice.controllerSessionId === controllerSessionId), 'peeking does not consume');
		const taken = await takePendingNotices(controllerSessionId);
		assert.equal(taken.length, 1, 'the agent still receives it once');
	} finally {
		await takePendingNotices(controllerSessionId);
	}
});

test('the controller journal lists what this machine dispatched', async () => {
	const { noteControllerDispatch, listControllerTasks } = await import('../lib/registry.js');
	noteControllerDispatch('session-journal-1', 'Hansomeneil', 5_000);
	noteControllerDispatch('session-journal-2', 'Mac', 6_000);
	const tasks = listControllerTasks().filter((task) => task.sessionId.startsWith('session-journal-'));
	assert.deepEqual(tasks.map((task) => [task.device, task.at]), [['Hansomeneil', 5_000], ['Mac', 6_000]]);
});
