/**
 * Cache-busting dynamic importer — the mechanism behind zero-restart updates.
 *
 * The stable shell (HTTP gate, tool schemas) never reloads; everything that
 * changes lives in one impl module per side. On each load() the current
 * signature (mtime+size of the impl files) is compared against the loaded
 * generation; a mismatch busts the module URL with `?v=<sig>`, so `git pull`
 * alone swaps in the next generation on the next request. Module instances
 * accumulate one per pull, which is bounded and negligible.
 *
 * @module dsh-device-fleet/hot
 */

import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

/**
 * Build a loader for one impl entry module.
 * @param {string} metaUrl `import.meta.url` of the calling shell module.
 * @param {string[]} files Impl files whose combined signature selects the generation; the first is the entry.
 * @returns {() => Promise<object>} Async loader returning the current impl module.
 */
export function hotImporter(metaUrl, files) {
	const dir = dirname(fileURLToPath(metaUrl));
	/** @type {string} */ let sig = '';
	/** @type {object | null} */ let mod = null;
	return async function load() {
		const parts = [];
		for (const file of files) {
			try {
				const info = await stat(join(dir, file));
				parts.push(`${file}:${Math.round(info.mtimeMs)}:${info.size}`);
			} catch {
				parts.push(`${file}:-`);
			}
		}
		const next = createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
		if (next !== sig || mod === null) {
			sig = next;
			mod = await import(`${pathToFileURL(join(dir, files[0])).href}?v=${next}`);
		}
		return mod;
	};
}
