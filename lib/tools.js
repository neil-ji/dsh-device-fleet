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
 * @module dsh-device-fleet/tools
 */

import { callWorker, pingWorker } from './client.js';
import { discoverWorkers } from './discovery.js';

/**
 * Resolve the configured worker entry, falling back to auto-discovered
 * devices. Tokens resolve late: explicit worker token → plugin token → the
 * credential resolver (spark-link pairing material), so discovery needs no
 * secret at all.
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
		return { ...configured, token: configured.token ?? (await config.resolveToken()) };
	}
	const found = config.discovered.get(name);
	if (found !== undefined) {
		const token = await config.resolveToken();
		return { name: found.name, url: found.url, ...(token !== '' ? { token } : {}) };
	}
	throw new Error(
		`unknown worker "${name}". Configured: ${config.workers.map((worker) => worker.name).join(', ') || '(none)'}; ` +
			`discovered so far: ${[...config.discovered.keys()].join(', ') || '(none — run fleet_list_workers to scan)'}`,
	);
}

/**
 * Render one structured output the way `output.render` expects.
 * @param {unknown} value Tool output value.
 * @returns {Array<{ type: string, text: string }>} Text blocks for the model.
 */
function renderJson(value) {
	return [{ type: 'text', text: JSON.stringify(value) }];
}

/**
 * Build all tool definitions against one resolved configuration.
 * @param {object} config Resolved plugin config.
 * @param {Array<{ name: string, url: string, token?: string }>} config.workers Configured worker endpoints.
 * @param {Map<string, { name: string, url: string, device: string }>} config.discovered Shared auto-discovery cache.
 * @param {() => Promise<string>} config.resolveToken Late token resolution.
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
			// One multicast scan per call: configured workers stay authoritative,
			// auto-discovered devices join the shared cache so later tool calls
			// can address them by name without any per-call rescanning.
			try {
				for (const entry of await discoverWorkers()) {
					if (!workers.some((worker) => worker.name === entry.name) && !config.discovered.has(entry.name)) {
						config.discovered.set(entry.name, entry);
					}
				}
			} catch {
				// multicast unavailable (sandbox, no LAN); configured entries still work
			}
			const all = [
				...workers.map((worker) => ({ name: worker.name, url: worker.url, token: worker.token ?? '' })),
				...[...config.discovered.values()].map((entry) => ({ name: entry.name, url: entry.url, token: '' })),
			];
			const token = await config.resolveToken();
			const results = await Promise.all(
				all.map(async (worker) => {
					if (worker.token === '' && token === '') {
						return { name: worker.name, online: false, error: 'reachable only with a token: set config.token or pair via spark-link' };
					}
					const ping = await pingWorker({ ...worker, token: worker.token !== '' ? worker.token : token });
					return { name: worker.name, online: ping.online, ...(ping.device !== undefined ? { device: ping.device } : {}), ...(ping.error !== undefined ? { error: ping.error } : {}) };
				}),
			);
			return { workers: results };
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
			const worker = await requireWorker(config, String(args?.worker ?? ''));
			const value = await callWorker(worker, 'GET', '/fleet/workspaces');
			return { items: /** @type {{ items: unknown[] }} */ (value).items ?? [] };
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
			const worker = await requireWorker(config, String(args?.worker ?? ''));
			const value = await callWorker(worker, 'GET', '/fleet/sessions');
			return { items: /** @type {{ items: unknown[] }} */ (value).items ?? [] };
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
				},
				required: ['status', 'worker', 'sessionId', 'mode'],
			},
			render: renderJson,
		},
		isConcurrencySafe: () => false,
		async execute(args) {
			const worker = await requireWorker(config, String(args?.worker ?? ''));
			const prompt = typeof args?.prompt === 'string' ? args.prompt : '';
			if (prompt.trim() === '') {
				return { status: 'error', worker: worker.name, sessionId: '', mode: 'queue', message: 'prompt must be a non-empty, self-contained task.' };
			}
			const sessionId = typeof args?.sessionId === 'string' ? args.sessionId.trim() : '';
			const workspaceId = typeof args?.workspaceId === 'string' ? args.workspaceId.trim() : '';
			const cwd = typeof args?.cwd === 'string' ? args.cwd.trim() : '';
			const chosen = [sessionId !== '', workspaceId !== '', cwd !== ''].filter(Boolean).length;
			if (chosen === 0) {
				return { status: 'error', worker: worker.name, sessionId: '', mode: 'queue', message: 'Provide exactly one of sessionId, workspaceId or cwd. Call fleet_list_sessions or fleet_list_workspaces to decide reuse vs create.' };
			}
			if (chosen > 1) {
				return { status: 'error', worker: worker.name, sessionId: '', mode: 'queue', message: 'sessionId, workspaceId and cwd are mutually exclusive.' };
			}
			const mode = args?.steer === true ? 'steer' : 'queue';
			let target = sessionId;
			if (target === '') {
				const body = workspaceId !== '' ? { workspaceId } : { cwd };
				const created = await callWorker(worker, 'POST', '/fleet/create', body);
				target = String(/** @type {{ sessionId: string }} */ (created).sessionId);
			}
			await callWorker(worker, 'POST', '/fleet/prompt', { sessionId: target, prompt, mode });
			return {
				status: sessionId !== '' ? 'dispatched' : 'created',
				worker: worker.name,
				sessionId: target,
				mode,
				message: `Task delivered to session ${target} on ${worker.name} (${mode}). Track it with fleet_status.`,
			};
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
			const worker = await requireWorker(config, String(args?.worker ?? ''));
			const sessionId = typeof args?.sessionId === 'string' ? args.sessionId.trim() : '';
			if (sessionId === '') {
				const value = await callWorker(worker, 'GET', '/fleet/status');
				return { status: null, items: /** @type {{ items: unknown[] }} */ (value).items ?? [] };
			}
			const value = await callWorker(worker, 'GET', `/fleet/status?sessionId=${encodeURIComponent(sessionId)}`);
			return { status: value, items: null };
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
			const worker = await requireWorker(config, String(args?.worker ?? ''));
			const sessionId = typeof args?.sessionId === 'string' ? args.sessionId.trim() : '';
			if (sessionId === '') return { status: 'error', message: 'sessionId is required.' };
			await callWorker(worker, 'POST', '/fleet/cancel', { sessionId });
			return { status: 'stopped', message: `Session ${sessionId} on ${worker.name} stopped; the session is kept and continuable.` };
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
			const worker = await requireWorker(config, String(args?.worker ?? ''));
			const sessionId = typeof args?.sessionId === 'string' ? args.sessionId.trim() : '';
			if (sessionId === '') return { sessionId: '', messages: [{ role: 'error', text: 'sessionId is required.' }] };
			const query = typeof args?.limit === 'number' && Number.isFinite(args.limit) ? `&limit=${Math.round(args.limit)}` : '';
			const value = await callWorker(worker, 'GET', `/fleet/recent?sessionId=${encodeURIComponent(sessionId)}${query}`);
			return { sessionId, messages: /** @type {{ messages: unknown[] }} */ (value).messages ?? [] };
		},
	};

	return [listWorkers, listWorkspaces, listSessions, dispatch, status, stop, recent];
}
