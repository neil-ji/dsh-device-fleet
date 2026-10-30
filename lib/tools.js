/**
 * Controller-side tool definitions.
 *
 * The calling Agent owns every decision: which worker, reuse or create a
 * workspace, reuse or create a session, queue or steer. These tools return the
 * facts (lists, ids, statuses) and the outcome codes; they never decide.
 *
 * Tool naming keeps the device-fleet prefix so the model groups them against
 * local subagent delegation.
 *
 * The schemas and descriptions live here and only change on a real plugin
 * reload; the behavior behind `execute` hot-swaps through `lib/hot.js`, so
 * pushed fixes go live on the next tool call without a restart.
 *
 * @module dsh-device-fleet/tools
 */

import { hotImporter } from './hot.js';

/** Tool calls always run against the freshest impl generation. */
const loadImpl = hotImporter(import.meta.url, ['controller-impl.js']);

/**
 * Obtain a usable token for a tokenless candidate: hello discloses it while
 * the worker is unclaimed (TOFU); the controller pins what it receives.
 * @param {object} config Tool configuration.
 * @param {{ name: string, url: string }} worker Candidate endpoint.
 * @returns {Promise<string>} Token, or '' when the worker is claimed and no pin exists.
 */
async function pairByHello(config, worker) {
	try {
		const value = await callWorker({ name: worker.name, url: worker.url }, 'GET', '/fleet/hello', undefined, 5_000);
		const info = /** @type {{ token?: string, claimable?: boolean }} */ (value ?? {});
		if (typeof info.token === 'string' && info.token !== '' && typeof config.pairPeer === 'function') {
			await config.pairPeer(worker.name, worker.url, info.token);
			await callWorker({ name: worker.name, url: worker.url, token: info.token }, 'POST', '/fleet/claim', { controller: config.controllerName ?? 'dsh-device-fleet' });
			return info.token;
		}
	} catch {
		// unreachable or old worker without hello; fall through
	}
	return '';
}

/**
 * Resolve the configured worker entry, falling back to auto-discovered
 * devices. Tokens resolve late: explicit worker token → plugin token → the
 * plugin-native TOFU pairing (`/fleet/hello` discloses the token until the
 * first controller claims the worker), so discovery needs no secret at all.
 * @param {object} config Tool configuration.
 * @param {Array<{ name: string, url: string, token?: string }>} config.workers Configured workers.
 * @param {Map<string, { name: string, url: string, device: string }>} config.discovered Shared auto-discovery cache.
 * @param {() => Promise<string>} config.resolveToken Late token resolution.
 * @param {string} name Requested worker name.
 * @returns {Promise<{ name: string, url: string, token?: string }>} Matched entry.
 */
async function requireWorker(config, name) {
	const configured = config.workers.find((worker) => worker.name === name);
	if (configured !== undefined) {
		const token = configured.token || (await config.resolveToken()) || (await pairByHello(config, configured));
		return { ...configured, ...(token !== '' ? { token } : {}) };
	}
	const found = config.discovered.get(name);
	if (found !== undefined) {
		const pinned = typeof config.pinnedToken === 'function' ? await config.pinnedToken(name) : '';
		const token = (await config.resolveToken()) || pinned || (await pairByHello(config, found));
		return { name: found.name, url: found.url, ...(token !== '' ? { token } : {}) };
	}
	throw new Error(
		`unknown worker "${name}". Configured: ${config.workers.map((worker) => worker.name).join(', ') || '(none)'}; ` +
			`discovered so far: ${[...config.discovered.keys()].join(', ') || '(none — run fleet_list_workers to scan)'}`,
	);
}

/**
 * Render one structured output the way `output.render` expects.
 *
 * The Host calls `render(args, value)` — the FIRST parameter is the tool
 * arguments, the second is the execute result. Reading the wrong one makes
 * every tool look like it echoed its input, which is exactly the bug this
 * signature documents. The renderer itself lives in the hot impl (via a
 * global slot) so wording/structure tweaks never need a shell reload.
 * @param {unknown} _args Tool arguments (unused).
 * @param {unknown} value Tool output value.
 * @returns {Array<{ type: string, text: string }>} Text blocks for the model.
 */
function renderJson(_args, value) {
	const renderer = globalThis.__fleetRender;
	if (typeof renderer === 'function') return renderer(_args, value);
	return [{ type: 'text', text: JSON.stringify(value) }];
}

/**
 * Build all tool definitions against one resolved configuration.
 * @param {object} config Resolved plugin config.
 * @param {Array<{ name: string, url: string, token?: string }>} config.workers Configured worker endpoints.
 * @param {Map<string, { name: string, url: string, device: string }>} config.discovered Shared auto-discovery cache.
 * @param {() => Promise<string>} config.resolveToken Late token resolution.
 * @param {() => Promise<Array<{ name: string, url: string }>>} [config.resolvePeers] persisted pinned peers (multicast fallback).
 * @param {(name: string, url: string, token: string) => Promise<void>} [config.pairPeer] Persist a TOFU pairing.
 * @param {(name: string) => Promise<string>} [config.pinnedToken] Token pinned for a worker by an earlier pairing.
 * @param {string} [config.controllerName] Name presented when claiming a worker.
 * @returns {Array<object>} Tool definitions for `ctx.tools.register`.
 */
export function createToolDefinitions(config) {
	const workers = config.workers;

	const listWorkers = {
		name: 'fleet_list_workers',
		description:
			'List the LAN DSH worker devices this Session can delegate heavy work to, with reachability. ' +
			'Call this first when a task is better suited to a powerful machine (VM work, video rendering, animation, large builds). ' +
			'Workers are configured in the plugin settings; this tool never discovers or modifies anything.',
		parameters: { type: 'object', properties: {}, additionalProperties: false },
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					workers: {
						type: 'array',
						items: {
							type: 'object',
							additionalProperties: false,
							properties: {
								name: { type: 'string' },
								online: { type: 'boolean' },
								device: { type: 'string' },
								version: { type: 'string' },
								commit: { type: 'string', description: 'Worker checkout commit; compare against local to spot stale deployments.' },
								error: { type: 'string' },
							},
							required: ['name', 'online'],
						},
					},
				},
				required: ['workers'],
			},
			render: renderJson,
		},
		isConcurrencySafe: () => true,
		async execute() {
			const impl = await loadImpl();
			return impl.run('fleet_list_workers', config, {});
		},
	};

	const listWorkspaces = {
		name: 'fleet_list_workspaces',
		description:
			'List the workspaces registered on one worker device, so you can decide whether an incoming task can reuse an existing workspace or needs a new one. ' +
			'Prefer reuse when the task belongs to a project that already exists on the worker.',
		parameters: {
			type: 'object',
			properties: { worker: { type: 'string', description: 'Worker name from fleet_list_workers.' } },
			required: ['worker'],
			additionalProperties: false,
		},
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					items: {
						type: 'array',
						items: {
							type: 'object',
							additionalProperties: false,
							properties: {
								workspaceId: { type: 'string' },
								title: { oneOf: [{ type: 'string' }, { type: 'null' }] },
								path: { oneOf: [{ type: 'string' }, { type: 'null' }] },
							},
							required: ['workspaceId', 'title', 'path'],
						},
					},
				},
				required: ['items'],
			},
			render: renderJson,
		},
		isConcurrencySafe: () => true,
		async execute(args) {
				const impl = await loadImpl();
				return impl.run('fleet_list_workspaces', config, args);
			},
	};

	const listSessions = {
		name: 'fleet_list_sessions',
		description:
			'List sessions on one worker device with title, running state, queued-message count and working directory. ' +
			'Use this to decide whether to continue an existing session (it already has the right context) or create a fresh one. ' +
			'A session that is running with queued turns may refuse or queue new input; check before dispatching.',
		parameters: {
			type: 'object',
			properties: { worker: { type: 'string', description: 'Worker name from fleet_list_workers.' } },
			required: ['worker'],
			additionalProperties: false,
		},
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					items: {
						type: 'array',
						items: {
							type: 'object',
							additionalProperties: false,
							properties: {
								sessionId: { type: 'string' },
								title: { oneOf: [{ type: 'string' }, { type: 'null' }] },
								running: { type: 'boolean' },
								blank: { type: 'boolean' },
								cwd: { oneOf: [{ type: 'string' }, { type: 'null' }] },
								updatedAt: { type: 'number' },
								agentAvailable: { type: 'boolean' },
								queuedTurns: { type: 'number' },
							},
							required: ['sessionId', 'title', 'running', 'blank', 'cwd', 'updatedAt', 'agentAvailable', 'queuedTurns'],
						},
					},
				},
				required: ['items'],
			},
			render: renderJson,
		},
		isConcurrencySafe: () => true,
		async execute(args) {
				const impl = await loadImpl();
				return impl.run('fleet_list_sessions', config, args);
			},
	};

	const dispatch = {
		name: 'fleet_dispatch',
		description:
			'Send a task prompt to a session on a worker device; the session runs on that machine with that machine\'s tools and compute. ' +
			'Reuse a session by passing sessionId, or create one by passing workspaceId or cwd (exactly one). ' +
			'Default delivery queues the message behind current work; steer: true makes it an immediate course correction the running agent sees on its next step — use it when the session went off track. ' +
			'If a person must approve something on the worker side, the session will pause at its question card; report that instead of retrying.',
		parameters: {
			type: 'object',
			properties: {
				worker: { type: 'string', description: 'Worker name from fleet_list_workers.' },
				sessionId: { type: 'string', description: 'Existing session to continue. Exclusive with workspaceId/cwd.' },
				workspaceId: { type: 'string', description: 'Workspace to create a new session in. Exclusive with sessionId/cwd.' },
				cwd: { type: 'string', description: 'Directory for a new session when no workspace fits. Exclusive with sessionId/workspaceId.' },
				prompt: { type: 'string', description: 'Complete, self-contained task for the worker-side agent. It does not see this conversation.' },
				steer: { type: 'boolean', description: 'Deliver as an immediate course correction (steer) instead of queueing. Default false.' },
				wait: { type: 'boolean', description: 'Block until the worker session goes idle, then return its last messages. Use it instead of hand-rolled polling loops.' },
				waitTimeoutMs: { type: 'number', description: 'Cap for wait, default 300000 (5 min), max 900000.' },
			},
			required: ['worker', 'prompt'],
			additionalProperties: false,
		},
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					status: { type: 'string', enum: ['dispatched', 'created', 'error'], description: 'dispatched: delivered to an existing session; created: new session made, then delivered.' },
					worker: { type: 'string' },
					sessionId: { type: 'string' },
					mode: { type: 'string', enum: ['queue', 'steer'] },
					message: { type: 'string' },
					waited: { type: 'boolean', description: 'True when wait was requested and this result already reflects the finished turn.' },
					timedOut: { type: 'boolean', description: 'True when the wait cap elapsed while the session was still running.' },
					transcript: {
						type: 'array',
						description: 'Last messages, present when wait was used.',
						items: {
							type: 'object',
							additionalProperties: false,
							properties: { role: { type: 'string' }, text: { type: 'string' } },
							required: ['role', 'text'],
						},
					},
				},
				required: ['status', 'worker', 'sessionId', 'mode'],
			},
			render: renderJson,
		},
		isConcurrencySafe: () => false,
		async execute(args) {
				const impl = await loadImpl();
				return impl.run('fleet_dispatch', config, args);
			},
	};

	const status = {
		name: 'fleet_status',
		description:
			'Check one worker session: running state, queued-message count, title, last update time. ' +
			'Use it to track progress after fleet_dispatch; poll after a wait instead of tight-looping. ' +
			'Omit sessionId to list every session on the worker.',
		parameters: {
			type: 'object',
			properties: {
				worker: { type: 'string', description: 'Worker name from fleet_list_workers.' },
				sessionId: { type: 'string', description: 'Session to inspect; omit for all sessions.' },
			},
			required: ['worker'],
			additionalProperties: false,
		},
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					status: {
						oneOf: [
							{ type: 'object', additionalProperties: true },
							{ type: 'null' },
						],
						description: 'Single session report when sessionId was given.',
					},
					items: {
						oneOf: [
							{ type: 'array', items: { type: 'object', additionalProperties: true } },
							{ type: 'null' },
						],
						description: 'All sessions when sessionId was omitted.',
					},
				},
			},
			render: renderJson,
		},
		isConcurrencySafe: () => true,
		async execute(args) {
				const impl = await loadImpl();
				return impl.run('fleet_status', config, args);
			},
	};

	const stop = {
		name: 'fleet_stop',
		description:
			'Stop the current response of one worker session. The session itself is kept and stays continuable: ' +
			'follow up with fleet_dispatch (queue) to send a new instruction, or fleet_dispatch with steer while it runs again. ' +
			'Use it when the session is stuck or heading the wrong way and steering is not enough.',
		parameters: {
			type: 'object',
			properties: {
				worker: { type: 'string', description: 'Worker name from fleet_list_workers.' },
				sessionId: { type: 'string', description: 'Session whose current response should stop.' },
			},
			required: ['worker', 'sessionId'],
			additionalProperties: false,
		},
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					status: { type: 'string', enum: ['stopped', 'error'] },
					message: { type: 'string' },
				},
				required: ['status'],
			},
			render: renderJson,
		},
		isConcurrencySafe: () => false,
		async execute(args) {
				const impl = await loadImpl();
				return impl.run('fleet_stop', config, args);
			},
	};

	const recent = {
		name: 'fleet_recent',
		description:
			'Read the recent messages of one worker session — what the worker-side agent was asked and what it answered. ' +
			'Use it after fleet_status shows the session finished, to collect the task result, and to verify steer or stop actually landed. ' +
			'Returns a bounded transcript, most recent messages last.',
		parameters: {
			type: 'object',
			properties: {
				worker: { type: 'string', description: 'Worker name from fleet_list_workers.' },
				sessionId: { type: 'string', description: 'Session to read.' },
				limit: { type: 'number', description: 'Maximum messages; default 12, cap 50.' },
				finalOnly: { type: 'boolean', description: 'Return only the last assistant message — the conclusion, without the reasoning that led to it.' },
			},
			required: ['worker', 'sessionId'],
			additionalProperties: false,
		},
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					sessionId: { type: 'string' },
					messages: {
						type: 'array',
						items: {
							type: 'object',
							additionalProperties: false,
							properties: {
								role: { type: 'string' },
								text: { type: 'string' },
							},
							required: ['role', 'text'],
						},
					},
				},
				required: ['sessionId', 'messages'],
			},
			render: renderJson,
		},
		isConcurrencySafe: () => true,
		async execute(args) {
				const impl = await loadImpl();
				return impl.run('fleet_recent', config, args);
			},
	};

	return [listWorkers, listWorkspaces, listSessions, dispatch, status, stop, recent];
}
