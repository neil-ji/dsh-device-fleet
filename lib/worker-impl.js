/**
 * Worker implementation — the hot-swappable half of the fleet worker.
 *
 * `lib/server.js` is the stable socket shell (auth gate, listener lifetime);
 * this module holds everything that evolves. It is loaded through
 * `lib/hot.js`, so a `git pull` swaps the running handler on the next
 * request without any process restart.
 *
 * @module dsh-device-fleet/worker-impl
 */

import { randomUUID } from 'node:crypto';
import { VERSION, COMMIT } from './version.js';

/**
 * Summarize one registered workspace for cross-machine consumption.
 * @param {unknown} workspace Registry entry.
 * @returns {Record<string, unknown>} Plain facts only.
 */
function shapeWorkspace(workspace) {
	const item = /** @type {Record<string, unknown>} */ (workspace ?? {});
	return {
		workspaceId: String(item.id ?? ''),
		title: item.title ?? null,
		path: item.path ?? null,
	};
}

/**
 * Summarize one session row; projection blocks are dropped except the few
 * fields a controller agent needs to decide reuse vs create.
 * @param {unknown} row `sessionController.list` item.
 * @returns {Record<string, unknown>} Plain facts only.
 */
function shapeSession(row) {
	const item = /** @type {Record<string, unknown>} */ (row ?? {});
	const projections = /** @type {{ values?: Record<string, unknown> }} */ (item.projections ?? {});
	const values = projections.values ?? {};
	const inbox = /** @type {{ 'next-turn'?: unknown[] } | undefined} */ (values.inbox);
	return {
		sessionId: String(item.sessionId ?? ''),
		title: values.title ?? null,
		running: item.running === true,
		blank: item.blank === true,
		cwd: item.cwd ?? values.workingDirectory ?? null,
		updatedAt: item.updatedAt ?? 0,
		agentAvailable: item.agentAvailable === true,
		queuedTurns: Array.isArray(inbox?.['next-turn']) ? inbox['next-turn'].length : 0,
	};
}

/** Per-message transcript cap; long reports were truncated at 2000 and
 * unreadable across machines. 12k covers a full review without flooding. */
const MAX_MESSAGE_CHARS = 12_000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_LIST_ITEMS = 200;

/**
 * Extract a readable, bounded transcript from a session surface snapshot.
 * The Host's surface shape is not a stable contract for plugins, so this
 * walks the common container fields and falls back to truncated raw JSON —
 * the controller agent reads the result either way.
 * @param {unknown} snapshot `sessionQuery.readSurface` output.
 * @param {number} limit Maximum messages to keep (most recent wins).
 * @returns {Array<{ role: string, text: string }>} Shaped transcript.
 */
function shapeTranscript(snapshot, limit) {
	const container = /** @type {Record<string, unknown>} */ (snapshot ?? {});
	const shaped = [];
	const push = (role, text) => {
		const clean = String(text ?? '').trim();
		if (clean !== '' && role !== 'system') shaped.push({ role: String(role), text: clean.slice(0, MAX_MESSAGE_CHARS) });
	};
	const messageText = (message) => {
		const item = /** @type {Record<string, unknown>} */ (message ?? {});
		const blocks = Array.isArray(item.content) ? item.content : [];
		return blocks
			.map((block) => /** @type {Record<string, unknown>} */ (block ?? {}).text)
			.filter((value) => typeof value === 'string' && value.trim() !== '')
			.join('\n');
	};
	// Preferred: the session log event array (`readSurface`). Message events
	// carry `type: '<role>/message'` with the payload in `data`; tool and
	// lifecycle events are skipped — the controller wants the conversation.
	const events = Array.isArray(container.events) ? container.events : [];
	for (const event of events) {
		const record = /** @type {Record<string, unknown>} */ (event ?? {});
		const type = String(record.type ?? '');
		if (!type.endsWith('/message')) continue;
		const data = /** @type {Record<string, unknown>} */ (record.data ?? {});
		const message = /** @type {Record<string, unknown>} */ (data.message ?? data);
		const role = String(message.role ?? type.slice(0, type.length - '/message'.length));
		push(role, messageText(message));
	}
	if (shaped.length === 0) {
		const raw = container.messages ?? container.surface ?? container.nodes ?? container.items;
		if (Array.isArray(raw)) {
			for (const entry of raw) {
				const item = /** @type {Record<string, unknown>} */ (entry ?? {});
				push(item.role ?? item.kind ?? 'message', messageText(item));
			}
		}
	}
	if (shaped.length === 0) {
		let json = '';
		try {
			json = JSON.stringify(snapshot);
		} catch {
			json = String(snapshot);
		}
		// Cut without breaking out of a JSON string escape sequence.
		json = json.slice(0, 8000).replace(/\\(u[0-9a-fA-F]{0,3})?$/, '');
		return [{ role: 'raw', text: json }];
	}
	return shaped.slice(-limit);
}

/**
 * Build the request router. Exported for tests: `services` mocks the two Host
 * services so the full HTTP surface can be exercised without a Host.
 * @param {object} services Host service implementations.
 * @param {string} services.deviceName Display name announced to controllers.
 * @param {unknown} services.workspaceRegistry DSH workspace registry.
 * @param {unknown} services.sessionController DSH session controller.
 * @param {unknown} [services.sessionQuery] DSH session query service.
 * @param {{ isClaimable: () => Promise<boolean>, discloseToken: () => Promise<string>, claim: (name: string) => Promise<void> }} [services.pairing] TOFU pairing hooks; absent means hello reports not claimable.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} Handler.
 */

export function createHandler(services) {
	/**
	 * Send one JSON response and close the request.
	 * @param {import('node:http').ServerResponse} res Response stream.
	 * @param {number} status HTTP status.
	 * @param {unknown} payload JSON body.
	 */
	function reply(res, status, payload) {
		const body = JSON.stringify(payload);
		res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
		res.end(body);
	}

	/**
	 * Read and parse a bounded JSON body.
	 * @param {import('node:http').IncomingMessage} req Request stream.
	 * @returns {Promise<Record<string, unknown>>} Parsed object; rejects on oversize or bad JSON.
	 */
	function readJson(req) {
		return new Promise((resolve, reject) => {
			const chunks = [];
			let size = 0;
			req.on('data', (chunk) => {
				size += chunk.length;
				if (size > MAX_BODY_BYTES) {
					reject(Object.assign(new Error('body too large'), { statusCode: 413 }));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on('end', () => {
				try {
					const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
					if (parsed === null || typeof parsed !== 'object') throw new Error('body must be a JSON object');
					resolve(parsed);
				} catch (error) {
					reject(Object.assign(error, { statusCode: 400 }));
				}
			});
			req.on('error', reject);
		});
	}

	/**
	 * Run one route; every unknown failure becomes a 500 with a message.
	 * Session-controller calls need a real AbortSignal (`prompt` reads it
	 * unconditionally), so each request carries its own controller, aborted
	 * when the HTTP exchange ends.
	 * @param {import('node:http').IncomingMessage} req Request.
	 * @param {import('node:http').ServerResponse} res Response.
	 * @param {string} method HTTP method.
	 * @param {string} path Path without query.
	 * @param {URL} url Parsed URL.
	 * @returns {Promise<void>}
	 */
	async function route(req, res, method, path, url) {
		const ac = new AbortController();
		res.on('close', () => ac.abort());
		const { signal } = ac;
		if (method === 'GET' && path === '/fleet/ping') {
			reply(res, 200, { ok: true, app: 'dsh-device-fleet', device: services.deviceName, version: VERSION, commit: COMMIT });
			return;
		}
		// Trust-on-first-use pairing: the token is disclosed only until the
		// first controller claims this worker. Not part of the authenticated
		// surface — this endpoint IS the bootstrap for it.
		if (method === 'GET' && path === '/fleet/hello') {
			const claimable = services.pairing ? await services.pairing.isClaimable() : false;
			const payload = { ok: true, app: 'dsh-device-fleet', device: services.deviceName, version: VERSION, commit: COMMIT, claimable };
			if (claimable) payload.token = await services.pairing.discloseToken();
			reply(res, 200, payload);
			return;
		}
		if (method === 'POST' && path === '/fleet/claim') {
			const body = await readJson(req);
			const controllerName = typeof body.controller === 'string' && body.controller.trim() !== '' ? body.controller.trim() : 'controller';
			if (services.pairing) await services.pairing.claim(controllerName);
			reply(res, 200, { ok: true, claimedBy: controllerName });
			return;
		}
		if (method === 'GET' && path === '/fleet/workspaces') {
			const list = await /** @type {{ list: () => Promise<unknown[]> }} */ (services.workspaceRegistry).list();
			reply(res, 200, { items: (list ?? []).slice(0, MAX_LIST_ITEMS).map(shapeWorkspace) });
			return;
		}
		if (method === 'GET' && path === '/fleet/sessions') {
			const value = await /** @type {{ list: (request: unknown, signal?: AbortSignal) => Promise<{ items?: unknown[] }> }} */ (
				services.sessionController
			).list({}, signal);
			reply(res, 200, { items: (value?.items ?? []).slice(0, MAX_LIST_ITEMS).map(shapeSession) });
			return;
		}
		if (method === 'POST' && path === '/fleet/create') {
			const body = await readJson(req);
			const request = {};
			if (typeof body.workspaceId === 'string' && body.workspaceId !== '') request.workspaceId = body.workspaceId;
			else if (typeof body.cwd === 'string' && body.cwd !== '') request.cwd = body.cwd;
			else throw Object.assign(new Error('workspaceId or cwd is required'), { statusCode: 400 });
			if (typeof body.agentPreset === 'string' && body.agentPreset !== '') request.agentPreset = body.agentPreset;
			const value = await /** @type {{ create: (request: unknown) => Promise<{ sessionId: string }> }} */ (
				services.sessionController
			).create(request, signal);
			reply(res, 200, { sessionId: String(value.sessionId) });
			return;
		}
		if (method === 'POST' && path === '/fleet/prompt') {
			const body = await readJson(req);
			const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
			const text = typeof body.text === 'string' && body.text !== '' ? body.text : typeof body.prompt === 'string' ? body.prompt : '';
			if (sessionId === '' || text.trim() === '') {
				throw Object.assign(new Error('sessionId and non-empty text are required'), { statusCode: 400 });
			}
			const mode = body.mode === 'steer' ? 'steer' : 'queue';
			let timeZone = 'UTC';
			try {
				timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
			} catch {}
			await /** @type {{ prompt: (request: unknown) => Promise<unknown> }} */ (services.sessionController).prompt({
				requestId: typeof body.requestId === 'string' && body.requestId !== '' ? body.requestId : randomUUID(),
				sessionId,
				mode,
				content: [{ type: 'text', text }],
				clientTimeZone: timeZone,
			}, signal);
			reply(res, 200, { accepted: true, mode });
			return;
		}
		if (method === 'POST' && path === '/fleet/queue') {
			const body = await readJson(req);
			const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
			const itemId = typeof body.itemId === 'string' ? body.itemId : '';
			const action = body.action;
			if (sessionId === '' || itemId === '' || action === null || typeof action !== 'object') {
				throw Object.assign(new Error('sessionId, itemId and action are required'), { statusCode: 400 });
			}
			await /** @type {{ updateQueue: (request: unknown) => Promise<unknown> }} */ (services.sessionController).updateQueue({
				sessionId,
				itemId,
				action,
			}, signal);
			reply(res, 200, { accepted: true });
			return;
		}
		if (method === 'POST' && path === '/fleet/cancel') {
			const body = await readJson(req);
			const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
			if (sessionId === '') throw Object.assign(new Error('sessionId is required'), { statusCode: 400 });
			await /** @type {{ cancel: (request: unknown) => Promise<unknown> }} */ (services.sessionController).cancel({ sessionId }, signal);
			reply(res, 200, { accepted: true });
			return;
		}
		if (method === 'GET' && path === '/fleet/recent') {
			const sessionId = url.searchParams.get('sessionId') ?? '';
			if (sessionId === '') throw Object.assign(new Error('sessionId is required'), { statusCode: 400 });
			if (services.sessionQuery === undefined || typeof /** @type {{ readSurface?: unknown }} */ (services.sessionQuery).readSurface !== 'function') {
				throw Object.assign(new Error('worker does not expose sessionQuery'), { statusCode: 501 });
			}
			const snapshot = await /** @type {{ readSurface: (id: string) => Promise<unknown> }} */ (services.sessionQuery).readSurface(sessionId);
			const limit = Number.parseInt(url.searchParams.get('limit') ?? '12', 10);
			reply(res, 200, { sessionId, messages: shapeTranscript(snapshot, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 12) });
			return;
		}
		if (method === 'GET' && path === '/fleet/status') {
			const sessionId = url.searchParams.get('sessionId') ?? '';
			const value = await /** @type {{ list: (request: unknown, signal?: AbortSignal) => Promise<{ items?: unknown[] }> }} */ (
				services.sessionController
			).list({}, signal);
			const items = (value?.items ?? []).map(shapeSession);
			if (sessionId === '') {
				reply(res, 200, { items: items.slice(0, MAX_LIST_ITEMS) });
				return;
			}
			const found = items.find((item) => item.sessionId === sessionId);
			if (found === undefined) throw Object.assign(new Error('unknown session'), { statusCode: 404 });
			reply(res, 200, found);
			return;
		}
		throw Object.assign(new Error('not found'), { statusCode: 404 });
	}

	return async function handle(req, res) {
		const url = new URL(req.url ?? '/', 'http://localhost');
		const method = (req.method ?? 'GET').toUpperCase();
		try {
			await route(req, res, method, url.pathname, url);
		} catch (error) {
			const status = typeof error?.statusCode === 'number' ? error.statusCode : 500;
			reply(res, status, { error: error instanceof Error ? error.message : String(error) });
		}
	};
}

