import test from 'node:test';
import assert from 'node:assert/strict';
import { mountFleetPanel } from '../lib/panel.js';

const names = ['command-ship', 'compute-ship', 'docking-pad', 'discovery-beacon', 'report-capsule', 'standby-diorama'];

test('miniature assets are served through the authenticated whitelist', async () => {
	let route;
	mountFleetPanel({
		ctx: { webServer: { register(config) { route = config.handler; return () => {} }, tapIndex() { return () => {} } } },
		state: {},
		discovered: new Map(),
	});
	const get = async (path, remoteAddress = '127.0.0.1') => {
		let status, headers, body;
		await route(
			{ url: `/api/device-fleet/assets/${path}`, method: 'GET', headers: { host: 'localhost' }, socket: { remoteAddress } },
			{ writeHead(code, values) { status = code; headers = values }, end(value) { body = value } },
		);
		return { status, headers, body };
	};
	for (const name of names) {
		const result = await get(`${name}.png`);
		assert.equal(result.status, 200);
		assert.equal(result.headers['content-type'], 'image/png');
		assert.equal(result.headers['content-length'], String(result.body.length));
		assert.equal(result.body.subarray(1, 4).toString(), 'PNG');
		assert.equal(result.body.readUInt32BE(16), 768, `${name} is sized for the web`);
		assert.equal(result.body.readUInt32BE(20), 512);
	}
	assert.equal((await get('prompts.json')).status, 404);
	assert.equal((await get('unknown.png')).status, 404);
	assert.equal((await get('command-ship.png', '192.168.1.5')).status, 403);
});
