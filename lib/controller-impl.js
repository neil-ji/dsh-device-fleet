/**
 * Controller implementation — the hot-swappable half of the fleet controller.
 *
 * `lib/tools.js` is the stable shell (tool names, schemas, descriptions the
 * model sees); every `execute` delegates here through `lib/hot.js`, so a
 * `git pull` swaps tool behavior on the next call without a restart.
 *
 * @module dsh-device-fleet/controller-impl
 */

import { callWorker, pingWorker } from './client.js';
import { noteControllerDispatch } from './registry.js';
import { takePendingNotices } from './credentials.js';
import { discoverWorkers } from './discovery.js';

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
 * Fill the shared discovery cache from multicast and pinned peers.
 * Both a private LAN scan and the persisted peer store are cheap; failures are
 * tolerated so a sandboxed or offline Host still resolves configured workers.
 * @param {object} config Tool configuration.
 */
async function refreshCandidates(config) {
	try {
		for (const entry of await discoverWorkers()) {
			if (!config.workers.some((worker) => worker.name === entry.name) && !config.discovered.has(entry.name)) {
				config.discovered.set(entry.name, entry);
			}
		}
	} catch {
		// multicast unavailable (sandbox, no LAN)
	}
	if (typeof config.resolvePeers === 'function') {
		try {
			for (const peer of await config.resolvePeers()) {
				if (!config.workers.some((worker) => worker.name === peer.name) && !config.discovered.has(peer.name)) {
					config.discovered.set(peer.name, { name: peer.name, url: peer.url, device: peer.name });
				}
			}
		} catch {
			// persisted store unreadable
		}
	}
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
	const resolveDiscovered = async (entry) => {
		const pinned = typeof config.pinnedToken === 'function' ? await config.pinnedToken(entry.name) : '';
		const token = (await config.resolveToken()) || pinned || (await pairByHello(config, entry));
		return { name: entry.name, url: entry.url, ...(token !== '' ? { token } : {}) };
	};
	const found = config.discovered.get(name);
	if (found !== undefined) return resolveDiscovered(found);
	// A fresh Host (any restart) starts with an empty cache, so the first tool
	// call of a session used to fail with "unknown worker" until someone called
	// fleet_list_workers. Scan once here instead of making that the caller's job.
	await refreshCandidates(config);
	const afterScan = config.discovered.get(name);
	if (afterScan !== undefined) return resolveDiscovered(afterScan);
	throw new Error(
		`unknown worker "${name}". Configured: ${config.workers.map((worker) => worker.name).join(', ') || '(none)'}; ` +
			`discovered after a fresh scan: ${[...config.discovered.keys()].join(', ') || '(none — nothing answered on the LAN)'}`,
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
 * @param {() => Promise<Array<{ name: string, url: string }>>} [config.resolvePeers] persisted pinned peers (multicast fallback).
 * @param {(name: string, url: string, token: string) => Promise<void>} [config.pairPeer] Persist a TOFU pairing.
 * @param {(name: string) => Promise<string>} [config.pinnedToken] Token pinned for a worker by an earlier pairing.
 * @param {string} [config.controllerName] Name presented when claiming a worker.
 * @returns {Array<object>} Tool definitions for `ctx.tools.register`.
 */
export function handlers(config, ctx) {
	const workers = config.workers;
	return {
		'fleet_list_workers': async () => {
			// One multicast scan per call: configured workers stay authoritative,
			// auto-discovered devices join the shared cache so later tool calls
			// can address them by name without any per-call rescanning.
			await refreshCandidates(config);
			// Pinned peers are the multicast fallback: previously paired
			// paired, hosts known from pairing state. Ping decides liveness.
			if (typeof config.resolvePeers === 'function') {
				try {
					for (const peer of await config.resolvePeers()) {
						if (!workers.some((worker) => worker.name === peer.name) && !config.discovered.has(peer.name)) {
							config.discovered.set(peer.name, { name: peer.name, url: peer.url, device: peer.name });
						}
					}
				} catch {}
			}
			// Peers keep their pinned token; multicast-discovered entries start
			// tokenless and pair by hello below.
			const peers = typeof config.resolvePeers === 'function' ? await config.resolvePeers() : [];
			const all = [
				...workers.map((worker) => ({ name: worker.name, url: worker.url, token: worker.token ?? '' })),
				...peers.map((peer) => ({ name: peer.name, url: peer.url, token: peer.token ?? '' })),
				...[...config.discovered.values()]
					.filter((entry) => !peers.some((peer) => peer.name === entry.name) && !workers.some((worker) => worker.name === entry.name))
					.map((entry) => ({ name: entry.name, url: entry.url, token: '' })),
			];
			const fallbackToken = await config.resolveToken();
			const results = await Promise.all(
				all.map(async (worker) => {
					let token = worker.token !== '' ? worker.token : fallbackToken;
					if (token === '') {
						// Unpaired candidate: TOFU via /fleet/hello, pinning what we
						// receive so the next call skips the handshake.
						token = await pairByHello(config, worker);
						if (token === '') {
							return { name: worker.name, online: false, error: 'no token available: worker claimed by another controller, or set config.token on both ends' };
						}
					}
					const ping = await pingWorker({ ...worker, token });
					return { name: worker.name, online: ping.online, ...(ping.device !== undefined ? { device: ping.device } : {}), ...(ping.version !== undefined ? { version: ping.version } : {}), ...(ping.commit !== undefined ? { commit: ping.commit } : {}), ...(ping.error !== undefined ? { error: ping.error } : {}) };
				}),
			);
			return { workers: results };
				},
		'fleet_notices': async (_args, context) => {
			// Completions are parked instead of pushed into the chat, so this is how
			// the agent learns about them: on its own initiative, when a human is
			// actually present, never by stealing a turn boundary.
			const controllerSessionId = String(context?.agentId ?? '');
			if (controllerSessionId === '') return { count: 0, notices: [] };
			const notices = await takePendingNotices(controllerSessionId);
			return {
				count: notices.length,
				notices: notices.map((notice) => ({
					sessionId: String(notice.sessionId ?? ''),
					device: String(notice.device ?? ''),
					title: notice.title === undefined ? undefined : String(notice.title),
					at: Number(notice.at ?? 0),
				})),
			};
		},
		'fleet_list_workspaces': async (args) => {
			const worker = await requireWorker(config, String(args?.worker ?? ''));
			const value = await callWorker(worker, 'GET', '/fleet/workspaces');
			return { items: /** @type {{ items: unknown[] }} */ (value).items ?? [] };
				},
		'fleet_list_sessions': async (args) => {
			const worker = await requireWorker(config, String(args?.worker ?? ''));
			const value = await callWorker(worker, 'GET', '/fleet/sessions');
			return { items: /** @type {{ items: unknown[] }} */ (value).items ?? [] };
				},
		'fleet_dispatch': async (args) => {
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
			// Tell the worker-side agent how to reach a human: it must not block on
			// its own unattended question card.
			const dispatchedPrompt =
				`${prompt}\n\n[设备舰队] 如果需要人工确认，请调用 fleet_ask_human 提问（会转发给发起任务的人），不要使用 ask_user_question。`;
			noteControllerDispatch(target);
			await callWorker(worker, 'POST', '/fleet/prompt', {
				sessionId: target,
				text: dispatchedPrompt,
				mode,
				// The worker calls this back when the session goes idle; the
				// controller session is the thing that should be woken.
				...(ctx?.agentId ? { controllerSessionId: ctx.agentId, controllerPort: config.controllerPort ?? 48791 } : {}),
			});
			const base = {
				status: sessionId !== '' ? 'dispatched' : 'created',
				worker: worker.name,
				sessionId: target,
				mode,
				message: `Task delivered to session ${target} on ${worker.name} (${mode}). Track it with fleet_status.`,
			};
			if (args?.wait !== true) return base;
			// Blocking mode: poll until the worker session is idle, then hand back
			// the tail of the transcript so the caller does not build its own loop.
			const capMs = Math.min(Math.max(Number(args?.waitTimeoutMs) || 300_000, 10_000), 900_000);
			const startedAt = Date.now();
			while (Date.now() - startedAt < capMs) {
				await new Promise((resolve) => setTimeout(resolve, 5_000));
				let state;
				try {
					state = await callWorker(worker, 'GET', `/fleet/status?sessionId=${encodeURIComponent(target)}`);
				} catch {
					continue;
				}
				if (state?.running !== true) {
					let transcript = [];
					try {
						const tail = await callWorker(worker, 'GET', `/fleet/recent?sessionId=${encodeURIComponent(target)}&limit=2`);
						transcript = tail?.messages ?? [];
					} catch {}
					return { ...base, waited: true, transcript };
				}
			}
			return { ...base, waited: true, timedOut: true };
				},
		'fleet_status': async (args) => {
			const worker = await requireWorker(config, String(args?.worker ?? ''));
			const sessionId = typeof args?.sessionId === 'string' ? args.sessionId.trim() : '';
			if (sessionId === '') {
				const value = await callWorker(worker, 'GET', '/fleet/status');
				return { status: null, items: /** @type {{ items: unknown[] }} */ (value).items ?? [] };
			}
			const value = await callWorker(worker, 'GET', `/fleet/status?sessionId=${encodeURIComponent(sessionId)}`);
			return { status: value, items: null };
				},
		'fleet_stop': async (args) => {
			const worker = await requireWorker(config, String(args?.worker ?? ''));
			const sessionId = typeof args?.sessionId === 'string' ? args.sessionId.trim() : '';
			if (sessionId === '') return { status: 'error', message: 'sessionId is required.' };
			await callWorker(worker, 'POST', '/fleet/cancel', { sessionId });
			return { status: 'stopped', message: `Session ${sessionId} on ${worker.name} stopped; the session is kept and continuable.` };
				},
		'fleet_diagnose': async () => {
			await refreshCandidates(config);
			const peers = typeof config.resolvePeers === 'function' ? await config.resolvePeers() : [];
			const rows = [];
			const seen = new Set();
			const candidates = [
				...config.workers.map((worker) => ({ name: worker.name, url: worker.url, token: worker.token ?? '', source: 'config' })),
				...peers.map((peer) => ({ name: peer.name, url: peer.url, token: peer.token ?? '', source: 'pinned' })),
				...[...config.discovered.values()].map((entry) => ({ name: entry.name, url: entry.url, token: '', source: 'discovered' })),
			];
			for (const candidate of candidates) {
				if (seen.has(candidate.name)) continue;
				seen.add(candidate.name);
				let token = candidate.token !== '' ? candidate.token : await config.resolveToken();
				let tokenSource = candidate.token !== '' ? candidate.source : token !== '' ? 'config-token' : 'none';
				if (token === '') {
					token = await pairByHello(config, candidate);
					if (token !== '') tokenSource = 'tofu-paired-now';
				}
				let ping;
				try {
					ping = token === '' ? { online: false, error: 'no token' } : await pingWorker({ name: candidate.name, url: candidate.url, token });
				} catch (error) {
					ping = { online: false, error: error instanceof Error ? error.message : String(error) };
				}
				rows.push({
					name: candidate.name,
					url: candidate.url,
					online: ping.online === true,
					tokenSource,
					...(ping.device !== undefined ? { device: ping.device } : {}),
					...(ping.version !== undefined ? { version: ping.version } : {}),
					...(ping.commit !== undefined ? { commit: ping.commit } : {}),
					...(ping.error !== undefined ? { error: ping.error } : {}),
				});
			}
			return { workers: rows, cached: [...config.discovered.keys()], configured: config.workers.map((worker) => worker.name) };
		},
		'fleet_exec': async (args) => {
			const worker = await requireWorker(config, String(args?.worker ?? ''));
			const command = typeof args?.command === 'string' ? args.command.trim() : '';
			if (command === '') return { status: 'denied', reason: 'command is empty' };
			const body = {
				command,
				controller: config.controllerName ?? 'controller',
				...(typeof args?.cwd === 'string' && args.cwd !== '' ? { cwd: args.cwd } : {}),
				...(typeof args?.timeoutMs === 'number' ? { timeoutMs: args.timeoutMs } : {}),
				...(args?.env !== null && typeof args?.env === 'object' ? { env: args.env } : {}),
			};
			try {
				const value = await callWorker(worker, 'POST', '/fleet/exec', body, Math.min(Math.max(Number(args?.timeoutMs) || 120_000, 1_000), 600_000) + 15_000);
				return value;
			} catch (error) {
				return { status: 'denied', reason: error instanceof Error ? error.message : String(error) };
			}
		},
		'fleet_recent': async (args) => {
			const worker = await requireWorker(config, String(args?.worker ?? ''));
			const sessionId = typeof args?.sessionId === 'string' ? args.sessionId.trim() : '';
			if (sessionId === '') return { sessionId: '', messages: [{ role: 'error', text: 'sessionId is required.' }] };
			const query = typeof args?.limit === 'number' && Number.isFinite(args.limit) ? `&limit=${Math.round(args.limit)}` : '';
			const value = await callWorker(worker, 'GET', `/fleet/recent?sessionId=${encodeURIComponent(sessionId)}${query}`);
			const messages = /** @type {{ messages: Array<{ role: string, text: string }> }} */ (value).messages ?? [];
			if (args?.finalOnly === true) {
				const last = [...messages].reverse().find((message) => message.role === 'assistant');
				return { sessionId, messages: last === undefined ? [] : [last] };
			}
			return { sessionId, messages };
				},
	};
}


/**
 * Execute one tool's current implementation.
 * @param {string} name Tool name.
 * @param {object} config Tool configuration (same object the shell was built with).
 * @param {unknown} args Tool arguments.
 * @returns {Promise<unknown>} Tool output value.
 */
/**
 * Render one tool result for the model. Installed into the shell's global slot
 * on every call, so render changes ride the hot impl.
 * @param {unknown} _args Tool arguments.
 * @param {unknown} value Tool output value.
 * @returns {Array<{ type: string, text: string }>} Text blocks.
 */
export function renderToolResult(_args, value) {
	return [{ type: 'text', text: JSON.stringify(value) }];
}

export async function run(name, config, args, ctx) {
	globalThis.__fleetRender = renderToolResult;
	const handler = handlers(config, ctx)[name];
	if (handler === undefined) throw new Error(`unknown tool ${name}`);
	return handler(args);
}
