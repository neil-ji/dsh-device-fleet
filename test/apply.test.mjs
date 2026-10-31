/**
 * Activation smoke test.
 *
 * The crash this guards against: `apply()` referenced a helper that only the
 * controller branch defined, so the worker branch threw a ReferenceError during
 * activation and the whole Host failed to start. Unit tests never called
 * `apply()`, so nothing caught it.
 *
 * Both role branches are activated against a mock context; any throw or
 * unhandled rejection fails the test (node's default unhandled-rejection mode).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.js';

/** Minimal Cordis-like context: enough surface for both role branches. */
function mockContext() {
	const disposers = [];
	const handlers = new Map();
	return {
		disposers,
		handlers,
		ctx: {
			effect: (fn) => {
				const disposer = fn();
				disposers.push(disposer);
				return disposer;
			},
			on: (name, listener) => {
				handlers.set(name, listener);
				return () => {};
			},
			tools: { register: () => () => {} },
			agents: { get: () => undefined },
			sessionController: { prompt: async () => ({ accepted: true }), list: async () => ({ items: [] }) },
			workspaceRegistry: { list: async () => [] },
			sessionQuery: { readSurface: async () => ({}) },
			webServer: { register: () => () => {}, registerFallback: () => () => {}, tapIndex: () => () => {} },
		},
	};
}

/**
 * Run one role and dispose whatever it registered.
 * @param {string} role Role to activate.
 * @param {Record<string, unknown>} [extra] Extra config.
 */
async function activate(role, extra = {}) {
	const mock = mockContext();
	apply(mock.ctx, { role, token: 'test-token', host: '127.0.0.1', port: 49000 + Math.floor(Math.random() * 500), ...extra });
	await new Promise((resolve) => setTimeout(resolve, 400));
	for (const disposer of mock.disposers.reverse()) {
		if (typeof disposer !== 'function') continue;
		try {
			await disposer();
		} catch {
			// teardown must not fail the assertions
		}
	}
	return mock;
}

test('controller role activates without throwing', async () => {
	const mock = await activate('controller');
	assert.ok(mock.handlers.has('api-session/added'), 'controller subscribes to the session feed');
});

test('worker role activates without throwing (the reference-error regression)', async () => {
	await activate('worker');
});
