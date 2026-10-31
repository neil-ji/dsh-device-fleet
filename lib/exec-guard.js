/**
 * Decide whether one `fleet_exec` request may run, before any process starts.
 *
 * Deliberately strict and boring: no shell, no quoting, no inline code. A worker
 * hands this module a command string and its own policy and gets back either an
 * argv array to spawn or a reason to refuse. Everything here is pure, so every
 * refusal is testable offline — which matters more than convenience, because a
 * hole in this file is remote code execution on the other machine.
 *
 * @module dsh-device-fleet/exec-guard
 */

/** Rejected outright: anything a shell would interpret. */
const SHELL_META = /[;&|<>`$()\n\r"']/;

/** Flags that turn an allowed binary into an interpreter for arbitrary code. */
const INLINE_EXEC_FLAGS = new Set(['-c', '-e', '--eval', '-Command', '-EncodedCommand', '-File', '/c', '/k']);

/**
 * Normalize a program name for allowlist comparison (`git.exe` and `GIT` both → `git`).
 * @param {string} token First argv token.
 * @returns {string} Comparable name.
 */
function programName(token) {
	const base = token.split(/[\\/]/).pop() ?? token;
	return base.toLowerCase().replace(/\.exe$/, '');
}

/**
 * Plan one execution.
 * @param {string} command Command line as typed by the controller.
 * @param {{ mode: 'off' | 'allowlist' | 'any', allow: readonly string[] }} policy Worker policy.
 * @returns {{ ok: true, argv: string[] } | { ok: false, reason: string }} Plan or refusal.
 */
export function planExec(command, policy) {
	const mode = policy?.mode ?? 'off';
	const allow = new Set((policy?.allow ?? []).map((entry) => programName(String(entry))));

	if (mode === 'off') return { ok: false, reason: 'exec is disabled on this worker (set exec.mode to allowlist or any)' };
	const line = typeof command === 'string' ? command.trim() : '';
	if (line === '') return { ok: false, reason: 'command is empty' };
	if (SHELL_META.test(line)) {
		return { ok: false, reason: 'command contains shell metacharacters or quoting; pass a plain argv line such as "git status --short"' };
	}
	const argv = line.split(/\s+/);
	const name = programName(argv[0]);
	if (mode === 'allowlist' && !allow.has(name)) {
		return { ok: false, reason: `program "${name}" is not in this worker's exec.allow list` };
	}
	for (const token of argv.slice(1)) {
		if (INLINE_EXEC_FLAGS.has(token)) {
			return { ok: false, reason: `flag "${token}" runs inline code and is never allowed through fleet_exec` };
		}
	}
	return { ok: true, argv };
}

/**
 * Whether a working directory is acceptable for the given policy.
 * `allowlist` keeps work inside the plugin directory; `any` still refuses paths
 * outside the filesystem root by resolving them first.
 * @param {string} resolvedCandidate Absolute, already-resolved path.
 * @param {string} pluginDir Absolute plugin directory.
 * @param {'off' | 'allowlist' | 'any'} mode Worker policy.
 * @returns {{ ok: true } | { ok: false, reason: string }} Verdict.
 */
export function checkCwd(resolvedCandidate, pluginDir, mode) {
	if (mode === 'any') return { ok: true };
	const within = resolvedCandidate === pluginDir || resolvedCandidate.startsWith(`${pluginDir}/`) || resolvedCandidate.startsWith(`${pluginDir}\\`);
	return within ? { ok: true } : { ok: false, reason: `cwd must stay inside ${pluginDir} in allowlist mode` };
}
