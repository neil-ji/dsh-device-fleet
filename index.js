/**
 * dsh-device-fleet — one plugin, two halves.
 *
 * On every machine it installs it can act as a worker (exposes this DSH's
 * workspaces and sessions to the LAN over a token-authenticated HTTP API) and
 * as a controller (gives the local Agent tools to drive configured workers).
 * `role` in Config turns either half off; both on is the useful default for a
 * fleet where every machine can delegate to every other.
 *
 * Design contract: the worker half is a thin adapter over the same Host
 * services the Web GUI drives (`workspaceRegistry`, `sessionController`), so
 * a controller Agent gets GUI-parity semantics — session reuse, queued
 * prompts, steer (插队), and cancel — without this plugin inventing any task
 * execution of its own. The worker-side agent remains a normal DSH session
 * that the person on that machine can watch, answer, or take over.
 *
 * Failure posture mirrors dsh-workspace-tools: everything is registered
 * inside try/catch, and a defect in this plugin costs only its own tools and
 * listener, never Host startup.
 *
 * @module dsh-device-fleet
 */

import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { startWorkerServer } from './lib/server.js';
import { createToolDefinitions } from './lib/tools.js';
import { ensureWorkerToken, isClaimable, markClaimed, pinPeer, pinnedPeers } from './lib/credentials.js';
import { getDispatch, noteCallback } from './lib/registry.js';
import { startAnnouncing } from './lib/discovery.js';
import { mountFleetPanel } from './lib/panel.js';

/** @type {string[]} Services this plugin needs from the Host composition. */
export const inject = ['tools', 'agents', 'workspaceRegistry', 'sessionController', 'sessionQuery', 'webServer'];

/** Auto-discovered workers, shared across tool calls and populated by fleet_list_workers. */
const discovered = new Map();

/** Roles accepted by `config.role`. */
const ROLES = ['worker+controller', 'worker', 'controller'];

/** Bind address and port used when the row leaves them out. */
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 48791;

/**
 * Declare the row schema in the interface the Loader validates: a Standard
 * Schema (`~standard.validate`), which `@deepseek-ai/schemastery` provides.
 * Only such a schema is projected into the Settings form, so the import is
 * attempted at load time and stays optional: a checkout whose dependencies
 * were never installed still activates, just without the form.
 * `apply` normalizes the raw config either way.
 */
let Config;
try {
	const { default: Schema } = await import('@deepseek-ai/schemastery');
	Config = Schema.object({
		role: Schema.union(ROLES).default('worker+controller').description('worker 暴露本机；controller 提供委派工具。'),
		host: Schema.string().default(DEFAULT_HOST).description('worker 监听地址。'),
		port: Schema.natural().default(DEFAULT_PORT).description('worker 监听端口。'),
		token: Schema.string().default('').description('留空则 worker 首次激活时自动生成并持久化，controller 首连自动配对（TOFU）；显式设置时两端必须一致。'),
		workers: Schema.array(
			Schema.object({
				name: Schema.string().description('worker 名称，工具调用时使用。'),
				url: Schema.string().description('worker 地址，如 http://192.168.1.74:48791'),
				token: Schema.string().description('留空则沿用本机 token。'),
			}),
		)
			.default([])
			.description('静态 worker 名单；留空则首次调用时自动组播发现。'),
	});
} catch {
	Config = undefined;
}
export { Config };

/**
 * Resolve defaults and drop malformed entries from one row config.
 * @param {unknown} raw Row config supplied by the Loader.
 * @returns {{role: string, host: string, port: number, token: string, workers: Array<{name: string, url: string, token: string}>}} Normalized config.
 */
function normalizeConfig(raw) {
	const source = /** @type {Record<string, unknown>} */ (raw ?? {});
	const configured = Array.isArray(source.workers) ? source.workers : [];
	const token = typeof source.token === 'string' ? source.token : '';
	return {
		role: ROLES.includes(/** @type {string} */ (source.role)) ? /** @type {string} */ (source.role) : 'worker+controller',
		host: typeof source.host === 'string' && source.host !== '' ? source.host : DEFAULT_HOST,
		port: Number.isInteger(source.port) && /** @type {number} */ (source.port) > 0 ? /** @type {number} */ (source.port) : DEFAULT_PORT,
		token,
		workers: configured
			.map((entry) => /** @type {Record<string, unknown>} */ (entry ?? {}))
			.filter((entry) => entry.name !== undefined && entry.url !== undefined)
			.map((entry) => ({
				name: String(entry.name),
				url: String(entry.url),
				token: typeof entry.token === 'string' ? entry.token : token,
			})),
	};
}

/**
 * Activate both halves according to `config.role`.
 * @param {import('@deepseek-ai/cordis').Context} ctx Host plugin context.
 * @param {Partial<{role: string, host: string, port: number, token: string, workers: unknown[]}>} config Row config.
 */
export function apply(ctx, config) {
	try {
		const resolved = normalizeConfig(config);
		const role = resolved.role;

		const deviceName = hostname() || 'dsh-worker';
		/** What the page shows; `apply` keeps it in step with the listener. */
		const state = {
			role,
			host: resolved.host,
			port: resolved.port,
			listening: false,
			tokenSource: resolved.token !== '' ? 'explicit' : '',
			tokenSet: resolved.token !== '',
			workers: resolved.workers.map((worker) => ({ name: worker.name, url: worker.url })),
		};

		/**
		 * Explicit config token wins; otherwise the worker generates and
		 * persists its own token on first activation (plugin-owned store).
		 */
		const resolveToken = async () => {
			if (resolved.token !== '') return resolved.token;
			return ensureWorkerToken();
		};

		ctx.effect(() => mountFleetPanel({ ctx, state, discovered }), 'device-fleet: 设置页端点');

		if (role.includes('worker')) {
			ctx.effect(() => {
				let closeServer = async () => {};
				let closeAnnounce = async () => {};
				const running = (async () => {
					const generated = resolved.token === '';
					const token = await resolveToken();
					const handle = await startWorkerServer({
						host: resolved.host,
						port: resolved.port,
						token,
						deviceName,
						// A paired worker authenticates its completion callback with
						// the token this side pinned for it, since it never learns
						// this listener's own token.
						verifyPeerToken: async (presented) => {
							const peers = await pinnedPeers();
							return Object.values(peers).some((peer) => `Bearer ${peer.token}` === presented);
						},
						onCallback: async (body) => {
							const target = String(body?.controllerSessionId ?? '');
							if (target === '') return false;
							const agent = ctx.agents.get(target);
							if (agent === undefined) return false;
							const text =
								`[设备舰队] ${String(body?.device ?? 'worker')} 上的会话 ${String(body?.sessionId ?? '')} 已空闲。` +
								`用 fleet_recent 读取结论（worker="${String(body?.device ?? '')}", sessionId="${String(body?.sessionId ?? '')}"）。`;
							try {
								await ctx.sessionController.prompt(
									{
										requestId: randomUUID(),
										sessionId: target,
										mode: 'queue',
										content: [{ type: 'text', text }],
										clientTimeZone: 'Asia/Shanghai',
									},
									new AbortController().signal,
								);
								return true;
							} catch (error) {
								console.error('[device-fleet] callback wake failed:', error instanceof Error ? error.message : error);
								return false;
							}
						},
						workspaceRegistry: ctx.workspaceRegistry,
						sessionController: ctx.sessionController,
						sessionQuery: ctx.sessionQuery,
						// TOFU pairing is offered only for a generated token; an
						// explicit config token is never disclosed over the wire.
						pairing: generated
							? {
								isClaimable: () => isClaimable(),
								discloseToken: () => ensureWorkerToken(),
								claim: (name) => markClaimed(name),
							}
							: undefined,
					});
					state.listening = true;
					state.port = handle.port;
					state.tokenSet = true;
					state.tokenSource = resolved.token !== '' ? 'explicit' : generated ? 'generated' : 'explicit';
					console.log(`[device-fleet] worker listening on ${resolved.host}:${handle.port}`);
					closeServer = handle.close;
					// Event-driven completion: the worker only ever reacts to the
					// Host's own status event, so a controller never has to poll.
					// `agent/status` is a scoped event (this: Scoped<Agent>), so a
					// plugin-root listener never sees it. `api-session/status` is the
					// unscoped running-state feed: same signal, deliverable here.
					ctx.effect(() =>
						ctx.on('api-session/status', (sessionId, running) => {
							if (running !== false) return;
							const id = String(sessionId);
							const dispatched = getDispatch(id);
							if (dispatched === undefined) return;
							fetch(`${dispatched.callbackUrl}/fleet/callback`, {
								method: 'POST',
								headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
								body: JSON.stringify({
									device: deviceName,
									sessionId: id,
									controllerSessionId: dispatched.controllerSessionId,
									at: Date.now(),
								}),
								signal: AbortSignal.timeout(8_000),
							})
								.then(async (response) => {
									const text = await response.text().catch(() => '');
									let body = {};
									try {
										body = JSON.parse(text);
									} catch {
										body = { raw: text.slice(0, 200) };
									}
									noteCallback({
										sessionId: id,
										ok: response.ok,
										woke: body?.woke === true,
										...(response.ok ? {} : { error: `HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}` }),
									});
								})
								.catch((error) => {
									noteCallback({ sessionId: id, ok: false, error: error instanceof Error ? error.message : String(error) });
								});
						}),
					);
					try {
						const announcer = await startAnnouncing({ port: handle.port, deviceName });
						closeAnnounce = announcer;
					} catch (error) {
						console.error('[device-fleet] announcing unavailable (discovery will not find this worker):', error instanceof Error ? error.message : error);
					}
				})();
				return async () => {
					state.listening = false;
					await running.catch(() => {});
					await closeAnnounce();
					await closeServer();
				};
			});
		}

		if (role.includes('controller')) {
			const tools = createToolDefinitions({
				workers: resolved.workers,
				discovered,
				resolveToken: async () => resolved.token,
				resolvePeers: async () => Object.entries(await pinnedPeers()).map(([name, peer]) => ({ name, url: peer.url, token: peer.token })),
				pairPeer: (name, url, token) => pinPeer(name, url, token),
				pinnedToken: async (name) => (await pinnedPeers())[name]?.token ?? '',
				controllerPort: resolved.port,
				controllerName: hostname() || 'dsh-controller',
			});
			for (const definition of tools) {
				ctx.effect(() => ctx.tools.register(definition));
			}
		}
	} catch (error) {
		console.error('[device-fleet] failed to register:', error);
	}
}
