/**
 * Ask forwarding: every branch of the worker -> controller question relay,
 * with an injected transport so the test is offline and deterministic.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardQuestion } from '../lib/ask-forward.js';

const request = { questions: [{ id: 'q1', question: '要继续吗？', options: [{ label: '要' }, { label: '不要' }] }] };
const answer = { answers: [{ id: 'q1', selected: ['要'] }] };

/** Build a fake fetch that records the call and returns one response. */
function fakeFetch(respond) {
	const calls = [];
	const impl = async (url, init) => {
		calls.push({ url, init });
		return respond();
	};
	impl.calls = calls;
	return impl;
}

test('forwards the question and returns the controller answer', async () => {
	const fetchImpl = fakeFetch(() => ({ ok: true, async json() { return answer; } }));
	const result = await forwardQuestion({ callbackUrl: 'http://127.0.0.1:48791/', token: 'tok', request, fetchImpl });
	assert.deepEqual(result, answer);
	assert.equal(fetchImpl.calls.length, 1);
	assert.equal(fetchImpl.calls[0].url, 'http://127.0.0.1:48791/fleet/ask');
	assert.equal(fetchImpl.calls[0].init.headers.authorization, 'Bearer tok');
	assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), { questions: request.questions });
});

test('returns null when the controller refuses or the shape is unexpected', async () => {
	for (const respond of [
		() => ({ ok: false, status: 401, async json() { return { error: 'unauthorized' }; } }),
		() => ({ ok: true, async json() { return { answers: [] }; } }),
		() => ({ ok: true, async json() { return {}; } }),
		() => ({ ok: true, async json() { throw new Error('not json'); } }),
	]) {
		assert.equal(await forwardQuestion({ callbackUrl: 'http://x', token: 't', request, fetchImpl: fakeFetch(respond) }), null);
	}
});

test('returns null on transport failure or timeout instead of throwing', async () => {
	const fetchImpl = async () => {
		throw new Error('EHOSTUNREACH');
	};
	assert.equal(await forwardQuestion({ callbackUrl: 'http://x', token: 't', request, fetchImpl }), null);
});

test('does nothing without a callback target, token, or questions', async () => {
	const fetchImpl = fakeFetch(() => ({ ok: true, async json() { return answer; } }));
	assert.equal(await forwardQuestion({ callbackUrl: '', token: 't', request, fetchImpl }), null);
	assert.equal(await forwardQuestion({ callbackUrl: 'http://x', token: '', request, fetchImpl }), null);
	assert.equal(await forwardQuestion({ callbackUrl: 'http://x', token: 't', request: { questions: [] }, fetchImpl }), null);
	assert.equal(await forwardQuestion({ callbackUrl: 'http://x', token: 't', request: {}, fetchImpl }), null);
	assert.equal(fetchImpl.calls.length, 0, 'no request is attempted when forwarding cannot work');
});

test('the card owner travels with the question only when known', async () => {
	const withOwner = fakeFetch(() => ({ ok: true, async json() { return answer; } }));
	await forwardQuestion({ callbackUrl: 'http://x', token: 't', request, controllerSessionId: 'session-abc', fetchImpl: withOwner });
	assert.equal(JSON.parse(withOwner.calls[0].init.body).controllerSessionId, 'session-abc');

	const withoutOwner = fakeFetch(() => ({ ok: true, async json() { return answer; } }));
	await forwardQuestion({ callbackUrl: 'http://x', token: 't', request, fetchImpl: withoutOwner });
	assert.equal('controllerSessionId' in JSON.parse(withoutOwner.calls[0].init.body), false);
});
