/**
 * Run one planned argv with a timeout, capped output, and an audit trail.
 *
 * No shell: the guard has already produced an argv array, and this module never
 * re-parses a command line. Output is capped because a chatty command must not
 * be able to flood the controller's context.
 *
 * @module dsh-device-fleet/exec-run
 */

import { spawn } from 'node:child_process';
import { appendFile } from 'node:fs/promises';

/** Cap per stream, so one command cannot blow up the transcript. */
export const MAX_OUTPUT_BYTES = 64 * 1024;

/**
 * Execute one argv and collect a bounded result.
 * @param {string[]} argv Program and arguments.
 * @param {{ cwd: string, timeoutMs?: number, env?: NodeJS.ProcessEnv }} options Execution options.
 * @returns {Promise<{ status: 'ok' | 'error' | 'timeout', exitCode: number | null, stdout: string, stderr: string, durationMs: number, truncated: boolean }>} Result.
 */
export function runExec(argv, options) {
	const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 120_000;
	const startedAt = Date.now();
	return new Promise((resolve) => {
		let truncated = false;
		const out = [];
		const err = [];
		let outBytes = 0;
		let errBytes = 0;
		/** @type {import('node:child_process').ChildProcess} */
		let child;
		try {
			child = spawn(argv[0], argv.slice(1), {
				cwd: options.cwd,
				env: options.env ?? process.env,
				shell: false,
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} catch (error) {
			resolve({ status: 'error', exitCode: null, stdout: '', stderr: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt, truncated: false });
			return;
		}
		child.stdout?.on('data', (chunk) => {
			outBytes += chunk.length;
			if (outBytes > MAX_OUTPUT_BYTES) {
				truncated = true;
				return;
			}
			out.push(chunk);
		});
		child.stderr?.on('data', (chunk) => {
			errBytes += chunk.length;
			if (errBytes > MAX_OUTPUT_BYTES) {
				truncated = true;
				return;
			}
			err.push(chunk);
		});
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			resolve({
				status: 'timeout',
				exitCode: null,
				stdout: Buffer.concat(out).toString('utf8'),
				stderr: Buffer.concat(err).toString('utf8'),
				durationMs: Date.now() - startedAt,
				truncated,
			});
		}, timeoutMs);
		child.on('error', (error) => {
			clearTimeout(timer);
			resolve({ status: 'error', exitCode: null, stdout: '', stderr: error.message, durationMs: Date.now() - startedAt, truncated });
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({
				status: 'ok',
				exitCode: code,
				stdout: Buffer.concat(out).toString('utf8'),
				stderr: Buffer.concat(err).toString('utf8'),
				durationMs: Date.now() - startedAt,
				truncated,
			});
		});
	});
}

/**
 * Append one audited execution. Never throws: audit failure must not fail a task.
 * @param {Record<string, unknown>} entry Audit record.
 * @param {string} path Audit log path.
 */
export async function appendAudit(entry, path) {
	try {
		await appendFile(path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });
	} catch {
		// best effort: the caller already returned the result
	}
}
