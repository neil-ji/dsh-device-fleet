/**
 * Execution plumbing: real spawns (small, offline), timeout behaviour, output
 * capping, and the audit append.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runExec, appendAudit, MAX_OUTPUT_BYTES } from '../lib/exec-run.js';

test('runs an allowed program and reports exit code and stdout', async () => {
	const result = await runExec(['node', '--version'], { cwd: tmpdir(), timeoutMs: 15_000 });
	assert.equal(result.status, 'ok');
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /^v\d+/);
});

test('a non-zero exit is reported, not thrown', async () => {
	const result = await runExec(['node', '--definitely-not-a-flag'], { cwd: tmpdir(), timeoutMs: 15_000 });
	assert.equal(result.status, 'ok');
	assert.notEqual(result.exitCode, 0);
});

test('a hanging command is killed at the timeout', async () => {
	const started = Date.now();
	const result = await runExec(['sleep', '5'], { cwd: tmpdir(), timeoutMs: 400 });
	assert.equal(result.status, 'timeout');
	assert.ok(Date.now() - started < 3_000, 'killed promptly rather than waiting for the process');
});

test('spawning a missing program reports an error instead of crashing', async () => {
	const result = await runExec(['definitely-not-installed-xyz'], { cwd: tmpdir(), timeoutMs: 5_000 });
	assert.equal(result.status, 'error');
});

test('audit appends one JSON line per execution', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'fleet-audit-'));
	const path = join(dir, 'exec.log');
	await appendAudit({ command: 'git status', exitCode: 0 }, path);
	await appendAudit({ command: 'git log', exitCode: 1 }, path);
	const lines = (await readFile(path, 'utf8')).trim().split('\n');
	assert.equal(lines.length, 2);
	assert.equal(JSON.parse(lines[0]).command, 'git status');
	assert.equal(JSON.parse(lines[1]).exitCode, 1);
});

test('output cap is a documented constant', () => {
	assert.equal(MAX_OUTPUT_BYTES, 64 * 1024);
});
