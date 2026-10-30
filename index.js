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
import { startWorkerServer } from './lib/server.js';
import { createToolDefinitions } from './lib/tools.js';
import { resolveFleetPeers, resolveFleetToken } from './lib/credentials.js';
import { startAnnouncing } from './lib/discovery.js';
import { mountFleetPanel } from './lib/panel.js';

/** @type {string[]} Services this plugin needs from the Host composition. */
export const inject = ['tools', 'workspaceRegistry', 'sessionController', 'sessionQuery', 'webServer'];

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
		token: Schema.string().default('').description('留空自动借用 spark-link 配对密钥；显式设置时两端必须一致。'),
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
		 * Late token resolution: explicit config first, then the spark-link
		 * pairing material. An empty result disables the worker and leaves
		 * discovered workers unpingable — the LAN surface never runs
		 * unauthenticated.
		 */
		const resolveToken = async () => {
			if (resolved.token !== '') return resolved.token;
			const borrowed = await resolveFleetToken();
			return borrowed?.token ?? '';
		};

		ctx.effect(() => mountFleetPanel({ ctx, state, discovered }), 'device-fleet: 设置页端点');

		if (role.includes('worker')) {
			ctx.effect(() => {
				let closeServer = async () => {};
				let closeAnnounce = async () => {};
				const running = (async () => {
					const token = await resolveToken();
					if (token === '') {
						console.error('[device-fleet] worker disabled: no token available (set config.token or pair spark-link)');
						return;
					}
					const handle = await startWorkerServer({
						host: resolved.host,
						port: resolved.port,
						token,
						deviceName,
						workspaceRegistry: ctx.workspaceRegistry,
						sessionController: ctx.sessionController,
						sessionQuery: ctx.sessionQuery,
					});
					state.listening = true;
					state.port = handle.port;
					state.tokenSet = true;
					state.tokenSource = resolved.token !== '' ? 'explicit' : 'spark-link';
					console.log(`[device-fleet] worker listening on ${resolved.host}:${handle.port}`);
					closeServer = handle.close;
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
				resolveToken,
				resolvePeers: () => resolveFleetPeers(undefined, resolved.port),
			});
			for (const definition of tools) {
				ctx.effect(() => ctx.tools.register(definition));
			}
		}
	} catch (error) {
		console.error('[device-fleet] failed to register:', error);
	}
}
