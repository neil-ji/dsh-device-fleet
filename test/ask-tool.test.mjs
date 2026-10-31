/**
 * `fleet_ask_human`: result shaping and the two failure modes that must be loud
 * rather than silently guessing an answer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { askHuman, shapeAskResult } from '../lib/ask-tool.js';

test('an answered question becomes a usable tool result', () => {
	const out = shapeAskResult({ answers: [{ id: 'q', selected: ['继续'], custom: '顺便跑测试' }] });
	assert.equal(out.status, 'answered');
	assert.deepEqual(out.answers, [{ id: 'q', selected: ['继续'], custom: '顺便跑测试' }]);
});

test('no answer is reported as unavailable, never as a guess', () => {
	for (const answer of [null, {}, { answers: [] }]) {
		const out = shapeAskResult(answer);
		assert.equal(out.status, 'unavailable');
		assert.match(out.message, /Do not guess/);
	}
});

test('askHuman refuses without a dispatch target or on transport failure', async () => {
	const noDispatch = await askHuman({ dispatch: undefined, token: 't', question: { question: 'x' } });
	assert.equal(noDispatch.status, 'unavailable');

	const transportFailure = await askHuman({
		dispatch: { callbackUrl: 'http://127.0.0.1:1' },
		token: 't',
		question: { question: 'x' },
		fetchImpl: async () => {
			throw new Error('EHOSTUNREACH');
		},
	});
	assert.equal(transportFailure.status, 'unavailable');
});

test('askHuman forwards one question with the caller token', async () => {
	let seen;
	const out = await askHuman({
		dispatch: { callbackUrl: 'http://controller:48791' },
		token: 'worker-token',
		question: { question: '继续吗？', options: [{ label: '继续' }, { label: '停止' }] },
		fetchImpl: async (url, init) => {
			seen = { url, auth: init.headers.authorization, body: JSON.parse(init.body) };
			return { ok: true, async json() { return { answers: [{ id: 'fleet-question', selected: ['继续'] }] }; } };
		},
	});
	assert.equal(seen.url, 'http://controller:48791/fleet/ask');
	assert.equal(seen.auth, 'Bearer worker-token');
	assert.equal(seen.body.questions[0].question, '继续吗？');
	assert.equal(seen.body.questions[0].options.length, 2);
	assert.equal(out.status, 'answered');
});
