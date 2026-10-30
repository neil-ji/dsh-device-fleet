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
import { discoverWorkers, primaryLanAddress } from './discovery.js';

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
					return sendJson(res, 200, {
						ok: true,
						data: {
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
