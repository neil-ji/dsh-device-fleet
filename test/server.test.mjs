/**
 * Worker HTTP surface smoke test — no DSH Host required: the two Host
 * services are replaced by in-memory fakes with the exact method shapes the
 * plugin consumes, and the full token gate + routing + mapping is exercised
 * over real sockets.
 *
 * Run: node --test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { startWorkerServer } from '../lib/server.js';
import { callWorker, pingWorker } from '../lib/client.js';

/** In-memory workspaceRegistry fake. */
function fakeWorkspaces() {
	return {
		list: async () => [
			{ id: 'w1', title: 'render', path: '/home/pc/render' },
			{ id: 'w2', title: 'vm', path: null },
		],
	};
}

/** In-memory sessionController fake recording every call. */
function fakeSessions() {
	const calls = [];
	return {
		calls,
		async list() {
			calls.push(['list']);
			return {
				items: [
					{
						sessionId: 's1',
						running: true,
						blank: false,
						updatedAt: 123,
						agentAvailable: true,
						projections: {
							kind: 'sequenced',
							asOfSeq: 9,
							values: { title: '渲染任务', workingDirectory: '/home/pc/render', inbox: { 'next-turn': [{}, {}] } },
						},
					},
					{ sessionId: 's2', running: false, blank: true, updatedAt: 5, projections: { values: {} } },
				],
			};
		},
		async create(request) {
			calls.push(['create', request]);
			return { sessionId: 's-new' };
		},
		async prompt(request) {
			calls.push(['prompt', request]);
			return { accepted: true };
		},
		async updateQueue(request) {
			calls.push(['updateQueue', request]);
			return { accepted: true };
		},
		async cancel(request) {
			calls.push(['cancel', request]);
			return { accepted: true };
		},
	};
}

test('token gate rejects missing and wrong credentials', async () => {
	const server = await startWorkerServer({
		host: '127.0.0.1',
		port: 0,
		token: 'sekret',
		deviceName: 'test-pc',
		workspaceRegistry: fakeWorkspaces(),
		sessionController: fakeSessions(),
	});
	try {
		const base = `http://127.0.0.1:${server.port}`;
		const noAuth = await fetch(`${base}/fleet/ping`);
		assert.equal(noAuth.status, 401);
		const badAuth = await fetch(`${base}/fleet/ping`, { headers: { authorization: 'Bearer wrong' } });
		assert.equal(badAuth.status, 401);
	} finally {
		await server.close();
	}
});

test('ping, workspaces and session shaping', async () => {
	const sessions = fakeSessions();
	const server = await startWorkerServer({
		host: '127.0.0.1',
		port: 0,
		token: 'sekret',
		deviceName: 'test-pc',
		workspaceRegistry: fakeWorkspaces(),
		sessionController: sessions,
	});
	const worker = { name: 'test', url: `http://127.0.0.1:${server.port}`, token: 'sekret' };
	try {
		const ping = await pingWorker(worker);
		assert.equal(ping.online, true);
		assert.equal(ping.device, 'test-pc');
		// build identity rides along; both fields are present in a checkout
		assert.equal(typeof ping.version, 'string');
		assert.equal(typeof ping.commit, 'string');

		const workspaces = await callWorker(worker, 'GET', '/fleet/workspaces');
		assert.deepEqual(workspaces.items, [
			{ workspaceId: 'w1', title: 'render', path: '/home/pc/render' },
			{ workspaceId: 'w2', title: 'vm', path: null },
		]);

		const sessionsValue = await callWorker(worker, 'GET', '/fleet/sessions');
		assert.equal(sessionsValue.items.length, 2);
		assert.deepEqual(
			{ ...sessionsValue.items[0] },
			{
				sessionId: 's1',
				title: '渲染任务',
				running: true,
				blank: false,
				cwd: '/home/pc/render',
				updatedAt: 123,
				agentAvailable: true,
				queuedTurns: 2,
			},
		);
		assert.equal(sessionsValue.items[1].queuedTurns, 0);

		const status = await callWorker(worker, 'GET', '/fleet/status?sessionId=s1');
		assert.equal(status.sessionId, 's1');
		await assert.rejects(callWorker(worker, 'GET', '/fleet/status?sessionId=nope'), /404/);
	} finally {
		await server.close();
	}
});

test('create, prompt queue/steer, queue update and cancel pass through', async () => {
	const sessions = fakeSessions();
	const server = await startWorkerServer({
		host: '127.0.0.1',
		port: 0,
		token: 'sekret',
		deviceName: 'test-pc',
		workspaceRegistry: fakeWorkspaces(),
		sessionController: sessions,
	});
	const worker = { name: 'test', url: `http://127.0.0.1:${server.port}`, token: 'sekret' };
	try {
		const created = await callWorker(worker, 'POST', '/fleet/create', { workspaceId: 'w1' });
		assert.equal(created.sessionId, 's-new');
		assert.deepEqual(sessions.calls.at(-1), ['create', { workspaceId: 'w1' }]);

		const byCwd = await callWorker(worker, 'POST', '/fleet/create', { cwd: '/tmp/x' });
		assert.equal(byCwd.sessionId, 's-new');

		await assert.rejects(callWorker(worker, 'POST', '/fleet/create', {}), /400/);

		await callWorker(worker, 'POST', '/fleet/prompt', { sessionId: 's1', text: '渲染这个视频', mode: 'queue' });
		const promptCall = sessions.calls.find(([kind]) => kind === 'prompt');
		assert.equal(promptCall[1].sessionId, 's1');
		assert.equal(promptCall[1].mode, 'queue');
		assert.deepEqual(promptCall[1].content, [{ type: 'text', text: '渲染这个视频' }]);
		assert.ok(typeof promptCall[1].requestId === 'string' && promptCall[1].requestId.length > 0);

		await callWorker(worker, 'POST', '/fleet/prompt', { sessionId: 's1', text: '改用 1080p', mode: 'steer', requestId: 'fixed-id' });
		const steer = sessions.calls.filter(([kind]) => kind === 'prompt').at(-1);
		assert.equal(steer[1].mode, 'steer');
		assert.equal(steer[1].requestId, 'fixed-id');

		await assert.rejects(callWorker(worker, 'POST', '/fleet/prompt', { sessionId: 's1', text: '   ' }), /400/);

		await callWorker(worker, 'POST', '/fleet/queue', { sessionId: 's1', itemId: 'i1', action: { kind: 'steer' } });
		assert.deepEqual(sessions.calls.at(-1), ['updateQueue', { sessionId: 's1', itemId: 'i1', action: { kind: 'steer' } }]);

		await callWorker(worker, 'POST', '/fleet/cancel', { sessionId: 's1' });
		assert.deepEqual(sessions.calls.at(-1), ['cancel', { sessionId: 's1' }]);
	} finally {
		await server.close();
	}
});

test('worker refuses to start without a token', async () => {
	await assert.rejects(
		startWorkerServer({
			host: '127.0.0.1',
			port: 0,
			token: '',
			deviceName: 'x',
			workspaceRegistry: fakeWorkspaces(),
			sessionController: fakeSessions(),
		}),
		/token/,
	);
});
