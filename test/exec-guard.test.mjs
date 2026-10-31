/**
 * Negative-first tests for the exec guard: every case here is a way to sneak
 * arbitrary code past an allowlist, and each must be refused.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { planExec, checkCwd } from '../lib/exec-guard.js';

const policy = { mode: 'allowlist', allow: ['git', 'node', 'pnpm'] };

test('mode off refuses everything', () => {
	assert.equal(planExec('git status', { mode: 'off', allow: ['git'] }).ok, false);
});

test('shell metacharacters and quoting are refused, even for allowed programs', () => {
	const sneaky = [
		'git status; rm -rf /',
		'git status && curl evil',
		'git status | sh',
		'git status > /etc/passwd',
		'git $(whoami)',
		'git `whoami`',
		'node --version\nrm -rf /',
		'git -c "core.pager=sh" log',
	];
	for (const command of sneaky) {
		const plan = planExec(command, policy);
		assert.equal(plan.ok, false, `should refuse: ${command}`);
	}
});

test('programs outside the allowlist are refused, including path-qualified ones', () => {
	for (const command of ['curl http://x', '/usr/bin/curl http://x', 'bash script.sh', 'powershell -NoProfile']) {
		assert.equal(planExec(command, policy).ok, false, `should refuse: ${command}`);
	}
	assert.equal(planExec('git.exe status', policy).ok, true, 'windows .exe spelling matches the allowlist');
});

test('inline-code flags are refused even when the program is allowed', () => {
	for (const command of ['node -e console.log(1)', 'node --eval x', 'python -c x', 'powershell -Command whoami']) {
		assert.equal(planExec(command, { mode: 'allowlist', allow: ['node', 'python', 'powershell'] }).ok, false, `should refuse: ${command}`);
	}
	// a plain invocation of an allowed program still works
	const plan = planExec('git rev-parse --short HEAD', policy);
	assert.equal(plan.ok, true);
	assert.deepEqual(plan.argv, ['git', 'rev-parse', '--short', 'HEAD']);
});

test('mode any still refuses metacharacters and inline flags', () => {
	assert.equal(planExec('git status; rm -rf /', { mode: 'any', allow: [] }).ok, false);
	assert.equal(planExec('node -e x', { mode: 'any', allow: [] }).ok, false);
	assert.equal(planExec('curl http://example.com', { mode: 'any', allow: [] }).ok, true);
});

test('cwd stays inside the plugin directory in allowlist mode', () => {
	const dir = '/Users/me/AIGC/dsh-device-fleet';
	assert.equal(checkCwd(`${dir}/lib`, dir, 'allowlist').ok, true);
	assert.equal(checkCwd(dir, dir, 'allowlist').ok, true);
	assert.equal(checkCwd('/etc', dir, 'allowlist').ok, false);
	assert.equal(checkCwd('/etc', dir, 'any').ok, true);
});

test('env overrides are limited to proxy keys and string values', async () => {
	const { checkEnv } = await import('../lib/exec-guard.js');
	assert.deepEqual(checkEnv({ HTTPS_PROXY: '' }), { ok: true, env: { HTTPS_PROXY: '' } });
	assert.equal(checkEnv({ LD_PRELOAD: '/tmp/x.so' }).ok, false);
	assert.equal(checkEnv({ NODE_OPTIONS: '--require /tmp/x.js' }).ok, false);
	assert.equal(checkEnv({ HTTPS_PROXY: 5 }).ok, false);
	assert.deepEqual(checkEnv(undefined), { ok: true, env: {} });
});
