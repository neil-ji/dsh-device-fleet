/**
 * Worker build identity.
 *
 * `ping` carries this so a controller can tell whether a worker is running
 * stale code — the failure mode joint debugging actually hit: the checkout
 * was updated but the plugin had not reloaded, and the only observable
 * symptom was a 404 on a new route.
 *
 * @module dsh-device-fleet/version
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Package version from package.json, or 'unknown'. */
export const VERSION = (() => {
	try {
		return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version ?? 'unknown';
	} catch {
		return 'unknown';
	}
})();

/** Short commit hash of the checkout, or 'unknown' when not a git worktree. */
export const COMMIT = (() => {
	try {
		return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: here, timeout: 3000, encoding: 'utf8' }).trim() || 'unknown';
	} catch {
		return 'unknown';
	}
})();
