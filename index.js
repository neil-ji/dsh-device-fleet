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

export const Config = {
	type: 'object',
	additionalProperties: false,
	properties: {
		role: {
			type: 'string',
			enum: ['worker+controller', 'worker', 'controller'],
			default: 'worker+controller',
			description: 'Which halves activate. worker: expose this DSH to the LAN. controller: register delegation tools.',
		},
		host: {
			type: 'string',
			default: '0.0.0.0',
			description: 'Worker bind address. 0.0.0.0 serves the home LAN; use a specific interface address to narrow it.',
		},
		port: {
			type: 'number',
			default: 48791,
			description: 'Worker TCP port. Must not collide with spark-link (8766) or the DSH GUI port.',
		},
		token: {
			type: 'string',
			default: '',
			description: 'Shared Bearer secret. The worker refuses to start with an empty token; set the identical value on controller and worker.',
		},
		workers: {
			type: 'array',
			default: [],
			description: 'Worker endpoints this machine may drive, for example [{name: "pc", url: "http://192.168.1.74:48791", token: "..."}].',
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					name: { type: 'string', description: 'Stable name the Agent uses in tool calls.' },
					url: { type: 'string', description: 'Base URL of the worker listener.' },
					token: { type: 'string', description: 'Bearer token; defaults to this machine\'s worker token.' },
				},
				required: ['name', 'url'],
			},
		},
	},
	required: [],
};

/**
 * Activate both halves according to `config.role`.
 * @param {import('@deepseek-ai/cordis').Context} ctx Host plugin context.
 * @param {Partial<{role: string, host: string, port: number, token: string, workers: unknown[]}>} config Row config.
 */
export function apply(ctx, config) {
	try {
		const role = config.role ?? 'worker+controller';

		if (role.includes('worker')) {
			ctx.effect(() => {
				let close = async () => {};
				const server = startWorkerServer({
					host: config.host ?? '0.0.0.0',
					port: config.port ?? 48791,
					token: config.token ?? '',
					deviceName: hostname() || 'dsh-worker',
					workspaceRegistry: ctx.workspaceRegistry,
					sessionController: ctx.sessionController,
				})
					.then((handle) => {
						console.log(`[device-fleet] worker listening on ${config.host ?? '0.0.0.0'}:${handle.port}`);
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
			const configured = Array.isArray(config.workers) ? config.workers : [];
			const tokenFallback = config.token ?? '';
			const workers = configured.map((worker) => {
				const entry = /** @type {Record<string, unknown>} */ (worker ?? {});
				return {
					name: String(entry.name ?? ''),
					url: String(entry.url ?? ''),
					token: String(entry.token ?? tokenFallback),
				};
			});
			const tools = createToolDefinitions({ workers });
			for (const definition of tools) {
				ctx.effect(() => ctx.tools.register(definition));
			}
		}
	} catch (error) {
		console.error('[device-fleet] failed to register:', error);
	}
}
