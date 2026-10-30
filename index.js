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

import { homedir, hostname } from 'node:os';
import { startWorkerServer } from './lib/server.js';
import { createToolDefinitions } from './lib/tools.js';

/** @type {string[]} Services this plugin needs from the Host composition. */
export const inject = ['tools', 'workspaceRegistry', 'sessionController'];

/** Roles accepted by `config.role`. */
const ROLES = ['worker+controller', 'worker', 'controller'];

/** Bind address and port used when the row leaves them out. */
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 48791;

/**
 * Declare the row schema in the interface the Loader validates: a Standard
 * Schema (`~standard.validate`), which `@deepseek-ai/schemastery` provides.
 * That package is not a runtime dependency here, so the schema is built when
 * the Host resolves it and omitted otherwise — a plain JSON Schema object in
 * this position makes activation fail, since it has no `~standard` field.
 * `apply` normalizes the raw config either way, so behavior never depends on
 * whether the schema was available.
 */
let Config;
try {
	const { default: Schema } = await import('@deepseek-ai/schemastery');
	Config = Schema.object({
		role: Schema.union(ROLES)
			.default('worker+controller')
			.description('Which halves activate. worker: expose this DSH to the LAN. controller: register delegation tools.'),
		host: Schema.string()
			.default(DEFAULT_HOST)
			.description('Worker bind address. 0.0.0.0 serves the home LAN; use a specific interface address to narrow it.'),
		port: Schema.natural()
			.default(DEFAULT_PORT)
			.description('Worker TCP port. Must not collide with spark-link (8766) or the DSH GUI port.'),
		token: Schema.string()
			.default('')
			.description('Shared Bearer secret. The worker refuses to start with an empty token; set the identical value on controller and worker.'),
		workers: Schema.array(
			Schema.object({
				name: Schema.string().description('Stable name the Agent uses in tool calls.'),
				url: Schema.string().description('Base URL of the worker listener.'),
				token: Schema.string().description('Bearer token; defaults to this machine\'s worker token.'),
			}),
		)
			.default([])
			.description('Worker endpoints this machine may drive, for example [{name: "pc", url: "http://192.168.1.74:48791", token: "..."}].'),
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

		if (role.includes('worker')) {
			ctx.effect(() => {
				let close = async () => {};
				const server = startWorkerServer({
					host: resolved.host,
					port: resolved.port,
					token: resolved.token,
					deviceName: hostname() || 'dsh-worker',
					workspaceRegistry: ctx.workspaceRegistry,
					sessionController: ctx.sessionController,
				})
					.then((handle) => {
						console.log(`[device-fleet] worker listening on ${resolved.host}:${handle.port}`);
						close = handle.close;
					})
					.catch((error) => {
						console.error('[device-fleet] worker listener failed:', error instanceof Error ? error.message : error);
					});
				return async () => {
					await server.catch(() => {});
					await close();
				};
			});
		}

		if (role.includes('controller')) {
			const tools = createToolDefinitions({ workers: resolved.workers });
			for (const definition of tools) {
				ctx.effect(() => ctx.tools.register(definition));
			}
		}
	} catch (error) {
		console.error('[device-fleet] failed to register:', error);
	}
}
