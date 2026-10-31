/**
 * Browser half's host endpoint: one token-gated prefix that serves the row's
 * status snapshot and accepts the four editable fields.
 *
 * The page runs inside the Host's own window, so it authenticates the same way
 * a desktop panel does: the Host injects a per-process token into index.html
 * (`window.__DSH_FLEET_TOKEN__`) and the page sends it back. Loopback peers
 * without the token still need a loopback Host header and same-origin writes.
 *
 * @module dsh-device-fleet/panel
 */

import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import os from 'node:os';
import { discoverWorkers, primaryLanAddress } from './discovery.js';
import { listControllerTasks, listDispatchEntries } from './registry.js';
import { peekPendingNotices, pinnedPeers, readStore } from './credentials.js';

export const PANEL_PATH = '/api/device-fleet';
const MAX_BODY = 16 * 1024;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const ROLES = ['worker+controller', 'worker', 'controller'];

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res Response stream.
 * @param {number} status HTTP status.
 * @param {unknown} payload JSON body.
 */
function sendJson(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
	});
	res.end(body);
}

/**
 * Read a bounded JSON body.
 * @param {import('node:http').IncomingMessage} req Request stream.
 * @returns {Promise<Record<string, unknown>>} Parsed object, or an empty one.
 */
async function readJson(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_BODY) throw new Error('请求体过大');
		chunks.push(chunk);
	}
	if (chunks.length === 0) return {};
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
		return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
	} catch {
		throw new Error('请求体不是合法 JSON');
	}
}

/**
 * Host part of a Host header, lowercased, without its port.
 * @param {unknown} value Raw header.
 * @returns {string} Host name.
 */
function hostNameOf(value) {
	const raw = String(value ?? '').trim().toLowerCase();
	if (!raw) return '';
	if (raw.startsWith('[')) {
		const close = raw.indexOf(']');
		return close >= 0 ? raw.slice(0, close + 1) : raw;
	}
	const colon = raw.lastIndexOf(':');
	return colon >= 0 && /^\d+$/.test(raw.slice(colon + 1)) ? raw.slice(0, colon) : raw;
}

/**
 * Whether the peer is this machine.
 * @param {import('node:http').IncomingMessage} req Request.
 * @returns {boolean} Loopback peer.
 */
function isLoopbackPeer(req) {
	const peer = String(req.socket?.remoteAddress || '');
	return !peer || /^(::1|::ffff:127\.|127\.)/.test(peer);
}

/**
 * Constant-time token comparison.
 * @param {string} supplied Caller token.
 * @param {string} token Expected token.
 * @returns {boolean} Whether they match.
 */
function tokenMatches(supplied, token) {
	if (supplied.length !== token.length) return false;
	let diff = 0;
	for (let index = 0; index < token.length; index += 1) diff |= supplied.charCodeAt(index) ^ token.charCodeAt(index);
	return diff === 0;
}

/**
 * Decide whether one request may touch this endpoint.
 * @param {import('node:http').IncomingMessage} req Request.
 * @param {string} token Page token.
 * @returns {string | null} Rejection reason, or null when allowed.
 */
function authorize(req, token) {
	const url = new URL(req.url, 'http://127.0.0.1');
	const supplied = req.headers?.['x-fleet-token'] || url.searchParams.get('t');
	if (typeof supplied === 'string' && supplied !== '' && tokenMatches(supplied, token)) return null;
	if (!isLoopbackPeer(req)) return `非本机请求被拒绝（对端 ${req.socket?.remoteAddress}）`;
	const host = hostNameOf(req.headers?.host);
	if (!LOOPBACK.has(host)) return '非本机请求被拒绝（Host 必须是回环地址）';
	const origin = req.headers?.origin;
	if (origin) {
		let originHost = '';
		try {
			originHost = new URL(origin).hostname;
		} catch {
			return '非法 Origin 头';
		}
		if (originHost !== host && !(LOOPBACK.has(host) && LOOPBACK.has(originHost))) return '跨源访问被拒绝';
	}
	const method = String(req.method || 'GET').toUpperCase();
	if (method !== 'GET' && method !== 'HEAD') {
		const contentType = String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
		if (contentType !== 'application/json') return '写请求必须是 application/json';
	}
	const site = req.headers?.['sec-fetch-site'];
	if (site && site !== 'same-origin' && site !== 'none') return `跨站请求被拒绝（sec-fetch-site=${site}）`;
	return null;
}

/**
 * Persist the editable fields into the active profile's patch.
 * @param {import('@deepseek-ai/cordis').Context} ctx Host plugin context.
 * @param {Record<string, unknown>} next Fields to write.
 * @returns {Promise<void>} Resolves once the Loader accepted the write.
 */
async function writeConfig(ctx, next) {
	const loader = ctx.get?.('loader');
	const editor = ctx.get?.('configEditor');
	if (!loader || !editor) {
		throw new Error('当前 profile 没有 loader/configEditor 服务，无法写入配置；请直接改 profile 的 cordis.patch.yml。');
	}
	const entry = [...loader.entries()].find((candidate) => candidate.options?.id === 'device-fleet');
	if (entry === undefined) throw new Error('Loader 里找不到 device-fleet 这一行');
	await editor.edit(entry, (current) => ({ ...current, ...next }));
}

/**
 * Normalize the form body into the four writable fields.
 * @param {Record<string, unknown>} body Raw request body.
 * @returns {Record<string, unknown>} Patch for the row config.
 */
function formPatch(body) {
	const patch = {};
	if (body.role !== undefined) {
		if (!ROLES.includes(String(body.role))) throw new Error(`role 必须是 ${ROLES.join(' / ')}`);
		patch.role = String(body.role);
	}
	if (body.host !== undefined) {
		const host = String(body.host).trim();
		if (host === '') throw new Error('监听地址不能为空');
		patch.host = host;
	}
	if (body.port !== undefined) {
		const port = Number(body.port);
		if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须是 1-65535 的整数');
		patch.port = port;
	}
	if (typeof body.token === 'string') patch.token = body.token;
	return patch;
}

/**
 * Mount the page endpoint and return its disposer.
 * @param {object} options Wiring.
 * @param {import('@deepseek-ai/cordis').Context} options.ctx Host plugin context.
 * @param {{role: string, host: string, port: number, listening: boolean, tokenSource: string, tokenSet: boolean, workers: Array<{name: string, url: string}>}} options.state Live row state, mutated by `apply`.
 * @param {Map<string, {name: string, url: string, device?: string}>} options.discovered Workers the tools discovered, shared with `fleet_list_workers`.
 * @returns {() => void} Disposer.
 */
export function mountFleetPanel({ ctx, state, discovered }) {
	const token = randomBytes(32).toString('base64url');
	const disposeRoute = ctx.webServer.register({
		kind: 'prefix',
		path: PANEL_PATH,
		handler: async (req, res) => {
			const blocked = authorize(req, token);
			if (blocked !== null) return sendJson(res, 403, { ok: false, why: blocked });
			const url = new URL(req.url, 'http://127.0.0.1');
			const route = url.pathname.slice(PANEL_PATH.length) || '/';
			const method = String(req.method || 'GET').toUpperCase();
			try {
				if (method === 'GET' && route === '/state') {
					const store = await readStore();
					const fleet = await collectFleetEntries({
						selfName: hostname() || 'dsh-worker',
						ownToken: String(store.workerToken ?? ''),
						timeoutMs: 1200,
					});
					const view = shapeFleetView({
						dispatches: fleet.dispatches,
						notices: await peekPendingNotices(),
						now: Date.now(),
					});
					return sendJson(res, 200, {
						ok: true,
						data: {
							view,
							workersOnline: fleet.workers,
							load: loadHint(),
							role: state.role,
							host: state.host,
							port: state.port,
							listening: state.listening,
							tokenSource: state.tokenSource,
							tokenSet: state.tokenSet,
							deviceName: hostname() || 'dsh-worker',
							lan: primaryLanAddress(),
							workers: state.workers,
							discovered: [...discovered.values()],
						},
					});
				}
				if (method === 'POST' && route === '/scan') {
					for (const worker of await discoverWorkers(2500)) {
						discovered.set(worker.name, worker);
					}
					return sendJson(res, 200, { ok: true, data: { discovered: [...discovered.values()] } });
				}
				if (method === 'POST' && route === '/config') {
					const body = await readJson(req);
					const patch = formPatch(body);
					await writeConfig(ctx, patch);
					return sendJson(res, 200, { ok: true, data: { patched: Object.keys(patch) } });
				}
				return sendJson(res, 404, { ok: false, why: `未知端点 ${method} ${route}` });
			} catch (error) {
				return sendJson(res, 400, { ok: false, why: error instanceof Error ? error.message : String(error) });
			}
		},
	});
	const disposeToken = ctx.webServer.tapIndex((html) => {
		if (!html.includes('</head>')) return html;
		const script = `<script>window.__DSH_FLEET_TOKEN__=${JSON.stringify(token)}</script>`;
		return html.replace('</head>', `${script}</head>`);
	});
	return () => {
		try {
			disposeToken?.();
		} catch {}
		try {
			disposeRoute?.();
		} catch {}
	};
}

/**
 * Shape the panel's task view.
 *
 * Pure so the rules are testable without HTTP: what counts as running, how a
 * stale entry is marked, and how old things read in words rather than raw numbers.
 * @param {object} input Snapshot inputs.
 * @param {Array<{ sessionId: string, controllerSessionId: string, device?: string, at: number, notified: boolean }>} input.dispatches Registry entries.
 * @param {Array<{ sessionId: string, device: string, at: number }>} input.notices Parked completions.
 * @param {number} input.now Current epoch milliseconds.
 * @param {number} [input.staleAfterMs] Age at which an unfinished task is called stale.
 * @returns {{ tasks: Array<Record<string, unknown>>, noticeCount: number, recentNotices: Array<Record<string, unknown>> }} View model.
 */
export function shapeFleetView(input) {
	const now = Number(input.now ?? Date.now());
	const staleAfter = Number(input.staleAfterMs ?? 30 * 60_000);
	const deviceOf = (entry) => String(entry.device ?? '未知设备');
	const noticeSessions = new Set((input.notices ?? []).map((notice) => String(notice.sessionId ?? '')));
	const tasks = (input.dispatches ?? [])
		.slice()
		.sort((left, right) => right.at - left.at)
		.map((entry) => {
			const ageMs = Math.max(0, now - Number(entry.at ?? now));
			const finished = entry.notified === true || noticeSessions.has(String(entry.sessionId ?? ''));
			const status = finished ? 'done' : ageMs > staleAfter ? 'stale' : 'running';
			return {
				sessionId: String(entry.sessionId ?? ''),
				shortId: String(entry.sessionId ?? '').slice(-8),
				controllerSessionId: String(entry.controllerSessionId ?? ''),
				device: deviceOf(entry),
				at: Number(entry.at ?? now),
				ageMs,
				status,
			};
		});
	const notices = (input.notices ?? []).slice().sort((left, right) => right.at - left.at);
	return {
		tasks,
		noticeCount: notices.length,
		recentNotices: notices.slice(0, 5).map((notice) => ({
			sessionId: String(notice.sessionId ?? ''),
			shortId: String(notice.sessionId ?? '').slice(-8),
			device: deviceOf(notice),
			at: Number(notice.at ?? 0),
		})),
	};
}

/**
 * Current mean system load, used as a cheap "is this machine busy" hint.
 * @returns {{ load1m: number, cpus: number }} Load hint.
 */
export function loadHint() {
	const load = os.loadavg()[0] ?? 0;
	return { load1m: Math.round(load * 100) / 100, cpus: os.cpus().length };
}

/**
 * Ask every known worker for its dispatch entries.
 *
 * The panel is a controller view, so reading only the local registry would show
 * just this machine's own work — which is exactly the case that looked broken
 * ("未知设备" for tasks that ran elsewhere). Each worker reports its own entries
 * and the panel merges them, tagging each with the worker it came from.
 * @param {object} options Aggregation options.
 * @param {string} options.selfName This machine's device name.
 * @param {string} options.ownToken Token this Host's worker half accepts.
 * @param {number} [options.timeoutMs] Per-worker timeout.
 * @returns {Promise<{ dispatches: Array<Record<string, unknown>>, workers: Array<{ name: string, online: boolean, latencyMs: number | null }> }>} Merged view.
 */
export async function collectFleetEntries(options) {
	const peers = await pinnedPeers();
	const targets = [
		{ name: options.selfName, url: null, token: options.ownToken },
		...Object.entries(peers)
			// A controller usually pins its own worker half too; listing it twice would
			// show every local task twice.
			.filter(([name]) => name !== options.selfName)
			.map(([name, peer]) => ({ name, url: peer.url, token: peer.token })),
	];
	const timeoutMs = Number(options.timeoutMs ?? 1500);
	const results = await Promise.all(
		targets.map(async (target) => {
			if (target.url === null) {
				return { name: target.name, online: true, latencyMs: 0, entries: listDispatchEntries() };
			}
			const started = Date.now();
			try {
				const response = await fetch(`${target.url.replace(/\/+$/, '')}/fleet/dispatches`, {
					headers: { authorization: `Bearer ${target.token}` },
					signal: AbortSignal.timeout(timeoutMs),
				});
				if (!response.ok) return { name: target.name, online: false, latencyMs: null, entries: [] };
				const body = await response.json();
				return { name: target.name, online: true, latencyMs: Date.now() - started, entries: Array.isArray(body?.entries) ? body.entries : [] };
			} catch {
				return { name: target.name, online: false, latencyMs: null, entries: [] };
			}
		}),
	);
	// Controller journal first: it is authoritative for what this machine sent out,
	// and it exists even when the worker runs an older build.
	const dispatches = listControllerTasks().map((task) => ({ ...task, device: task.device || '未知设备' }));
	const known = new Set(dispatches.map((task) => task.sessionId));
	for (const result of results) {
		for (const entry of result.entries) {
			if (known.has(String(entry.sessionId))) continue;
			dispatches.push({ ...entry, device: result.name });
		}
	}
	return {
		dispatches,
		workers: results.map((result) => ({ name: result.name, online: result.online, latencyMs: result.latencyMs })),
	};
}
