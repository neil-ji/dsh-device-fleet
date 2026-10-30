/**
 * Hot-swap semantics: same signature reuses the cached generation; a file
 * change busts the module URL and the new export becomes visible — the whole
 * point of the shell/impl split.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hotImporter } from '../lib/hot.js';

test('hot importer swaps generations when the impl file changes', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'hot-'));
	const entry = join(dir, 'impl.mjs');
	// generation 1
	await writeFile(entry, "export const gen = () => 'one';\n");
	// hotImporter stats files relative to the entry's dir: point it at the tmp module
	const loader = hotImporter(pathToFileURL(join(dir, 'shell.js')).href, ['impl.mjs']);
	const mod1 = await loader();
	assert.equal(mod1.gen(), 'one');

	// generation 2: content change with a distinct mtime (filesystems have 1s granularity)
	await writeFile(entry, "export const gen = () => 'two';\n");
	const later = new Date(Date.now() + 5000);
	await utimes(entry, later, later);
	const mod2 = await loader();
	assert.equal(mod2.gen(), 'two');
});
