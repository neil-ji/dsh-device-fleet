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
import { randomUUID } from 'node:crypto';
import { startWorkerServer } from './lib/server.js';
import { createToolDefinitions } from './lib/tools.js';
import { appendPendingNotice, ensureWorkerToken, isClaimable, markClaimed, pinPeer, pinnedPeers, takePendingNotices } from './lib/credentials.js';
import { acceptCallbackOnce, clearNotified, getDispatch, markNotified, noteArm, noteAsk, noteCallback, noteQuestionProbe, wasNotified } from './lib/registry.js';
import { askHuman } from './lib/ask-tool.js';
import { planWake, wakeSilently } from './lib/wake.js';
import { checkCwd, checkEnv, planExec } from './lib/exec-guard.js';
import { appendAudit, runExec } from './lib/exec-run.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startAnnouncing } from './lib/discovery.js';
import { mountFleetPanel } from './lib/panel.js';

/** @type {string[]} Services this plugin needs from the Host composition. */
export const inject = ['tools', 'agents', 'userQuestions', 'workspaceRegistry', 'sessionController', 'sessionQuery', 'webServer'];

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
		wake: Schema.union(['silent', 'off', 'thread'])
			.default('silent')
			.description('How a worker completion reaches this session. silent (default) wakes the agent through its inbox without writing a user message, so the agent continues by itself and the human\'s thread stays free of machine-authored messages; thread writes a user message (visible, interrupts); off only parks the notice for fleet_notices.'),
		exec: Schema.object({
			mode: Schema.union(['off', 'allowlist', 'any']).default('off').description('fleet_exec policy: off refuses everything; allowlist permits exec.allow programs inside the plugin directory; any also permits other directories.'),
			allow: Schema.array(Schema.string())
				.default(['git', 'node', 'pnpm', 'npm', 'python', 'python3', 'dotnet', 'ffmpeg'])
				.description('Program names allowed in allowlist mode. Inline code flags (-c/-e/-Command) are always refused.'),
		})
			.description('Remote command execution policy for this worker.')
			.default({ mode: 'off' }),
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
		wake: ['silent', 'off', 'thread'].includes(/** @type {string} */ (source.wake)) ? /** @type {string} */ (source.wake) : 'silent',
		exec: (() => {
			const rawExec = /** @type {Record<string, unknown>} */ (source.exec ?? {});
			const modes = ['off', 'allowlist', 'any'];
			const mode = modes.includes(/** @type {string} */ (rawExec.mode)) ? /** @type {string} */ (rawExec.mode) : 'off';
			const allow = Array.isArray(rawExec.allow)
				? rawExec.allow.map(String).filter((entry) => entry.trim() !== '')
				: ['git', 'node', 'pnpm', 'npm', 'python', 'python3', 'dotnet', 'ffmpeg'];
			return { mode, allow };
		})(),
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
		// `user-questions/request` is an Agent-scoped waterfall, so a plugin-root
		// listener never sees it (measured). Arm the listener on each dispatched
		// Agent's own scope instead. Both role branches use it, so it lives above
		// them: the worker half arms a session right after recording a dispatch,
		// and the global session feed covers sessions created later.
		const armedSessions = new Set();
		/** Filled once the worker listener is up; ask forwarding needs it. */
		let workerToken = '';
		const armSession = async (sessionId) => {
			const id = String(sessionId);
			if (id === '' || armedSessions.has(id)) return false;
			const agent = ctx.agents.get(id);
			if (agent === undefined) {
				noteArm({ sessionId: id, armed: false, reason: 'agent-not-live' });
				return false;
			}
			if (agent.ctx === undefined) {
				noteArm({ sessionId: id, armed: false, reason: `agent-ctx-missing:${Object.keys(agent).slice(0, 8).join(',')}` });
				return false;
			}
			agent.ctx.on('user-questions/request', async (request, next) => {
				noteQuestionProbe(request);
				const dispatched = getDispatch(id);
				if (dispatched !== undefined) {
					const forwarded = await forwardQuestion({
						callbackUrl: dispatched.callbackUrl,
						token: workerToken,
						request,
					});
					noteAsk({ sessionId: id, forwarded: true, answered: forwarded !== null });
					if (forwarded !== null) return forwarded;
					noteAsk({ sessionId: id, forwarded: false, answered: false });
				}
				// Nobody answered from the controller: keep the local card, which is
				// exactly what happens without this plugin.
				return next();
			});
			armedSessions.add(id);
			noteArm({ sessionId: id, armed: true, reason: 'armed' });
			return true;
		};
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
					workerToken = token;
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
						armSession,
						onExec: async (body) => {
							const pluginDir = dirname(fileURLToPath(import.meta.url));
							const policy = resolved.exec;
							const plan = planExec(String(body?.command ?? ''), policy);
							const audit = async (outcome) =>
								appendAudit(
									{
										controller: String(body?.controller ?? 'unknown'),
										command: String(body?.command ?? ''),
										cwd: String(body?.cwd ?? ''),
										policy: policy.mode,
										...outcome,
									},
									resolve(homedir(), '.dsh', 'device-fleet-exec.log'),
								);
							if (!plan.ok) {
								await audit({ status: 'denied', reason: plan.reason });
								return { status: 'denied', reason: plan.reason };
							}
							const requestedCwd = typeof body?.cwd === 'string' && body.cwd !== '' ? resolve(String(body.cwd)) : pluginDir;
							const cwdVerdict = checkCwd(requestedCwd, pluginDir, policy.mode);
							if (!cwdVerdict.ok) {
								await audit({ status: 'denied', reason: cwdVerdict.reason });
								return { status: 'denied', reason: cwdVerdict.reason };
							}
							const envVerdict = checkEnv(body?.env);
							if (!envVerdict.ok) {
								await audit({ status: 'denied', reason: envVerdict.reason });
								return { status: 'denied', reason: envVerdict.reason };
							}
							const timeoutMs = Math.min(Math.max(Number(body?.timeoutMs) || 120_000, 1_000), 600_000);
							const result = await runExec(plan.argv, {
								cwd: requestedCwd,
								timeoutMs,
								env: { ...process.env, ...envVerdict.env },
							});
							await audit({ status: result.status, exitCode: result.exitCode, durationMs: result.durationMs, truncated: result.truncated });
							return result;
						},
						onAsk: async (body) => {
							const questions = Array.isArray(body?.questions) ? body.questions : [];
							if (questions.length === 0) return null;
							if (typeof ctx.userQuestions?.ask !== 'function') return null;
							// The card must be owned by an Agent: a plugin-side ask without
							// one left the platform with nowhere to record the outcome, and
							// answering it restarted the Host. Use the session that
							// dispatched the task; without it, refuse instead of asking.
							const owner = ctx.agents.get(String(body?.controllerSessionId ?? ''));
							if (owner === undefined) return null;
							try {
								const answer = await ctx.userQuestions.ask({ questions, agent: owner });
								return answer ?? null;
							} catch (error) {
								console.error('[device-fleet] forward ask failed:', error instanceof Error ? error.message : error);
								return null;
							}
						},
						onCallback: async (body) => {
							const target = String(body?.controllerSessionId ?? '');
							if (target === '') return false;
							// Receiver-side idempotency: a worker can legitimately report
							// the same completion twice (re-dispatch resets its mark, and
							// a session can idle at several boundaries). Waking twice adds
							// only noise, so suppress repeats within the window.
							if (!acceptCallbackOnce(String(body?.sessionId ?? ''))) return false;
							const agent = ctx.agents.get(target);
							// Park it first: the notice must survive whether or not anyone is
							// looking, and it must never be lost to a failed wake.
							await appendPendingNotice({
								controllerSessionId: target,
								sessionId: String(body?.sessionId ?? ''),
								device: String(body?.device ?? 'worker'),
								title: body?.title === undefined ? undefined : String(body.title),
							}).catch(() => {});
							const decision = planWake({
								wake: resolved.wake,
								agentLive: agent !== undefined,
								agentHasInject: typeof agent?.inject === 'function',
							});
							if (decision === 'store') return { ok: true, woke: false, mode: 'store' };
							if (decision === 'silent') {
								const outcome = wakeSilently(agent);
								return { ok: true, woke: outcome.woke, mode: 'silent', ...(outcome.reason ? { reason: outcome.reason } : {}) };
							}
							if (agent === undefined) {
								return false;
							}
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
							if (dispatched === undefined || wasNotified(id)) return;
							// Mark BEFORE sending: two idle transitions can land within the
							// same tick, and both used to pass the check while the first
							// callback was still in flight (observed as duplicate wakes).
							markNotified(id);
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
									if (!(response.ok && body?.woke === true)) clearNotified(id);
									noteCallback({
										sessionId: id,
										ok: response.ok,
										woke: body?.woke === true,
										...(response.ok ? {} : { error: `HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}` }),
									});
								})
								.catch((error) => {
									clearNotified(id);
									noteCallback({ sessionId: id, ok: false, error: error instanceof Error ? error.message : String(error) });
								});
						}),
					);
					// A delegated agent needs one explicit way to reach this machine's
					// human. Intercepting the platform's own question waterfall is not
					// reliable from a plugin (Agent-scoped, measured), so the fleet
					// offers its own tool instead.
					ctx.effect(() =>
						ctx.tools.register({
							name: 'fleet_ask_human',
							description:
								'Ask the person on the controller machine one question when their decision is required, and block until they answer. ' +
								'Use this instead of ask_user_question inside a session that was started by a fleet dispatch: the controller forwards it to the person who dispatched the task.',
							parameters: {
								type: 'object',
								additionalProperties: false,
								properties: {
									question: { type: 'string', description: 'The question, in one or two sentences.' },
									options: {
										type: 'array',
										description: 'Optional choices; omit for a free-form answer.',
										items: {
											type: 'object',
											additionalProperties: false,
											properties: { label: { type: 'string' }, description: { type: 'string' } },
											required: ['label'],
										},
									},
								},
								required: ['question'],
							},
							output: {
								schema: {
									type: 'object',
									additionalProperties: false,
									properties: {
										status: { type: 'string', enum: ['answered', 'unavailable'] },
										answers: {
											type: 'array',
											items: {
												type: 'object',
												additionalProperties: false,
												properties: {
													id: { type: 'string' },
													selected: { type: 'array', items: { type: 'string' } },
													custom: { type: 'string' },
												},
												required: ['id', 'selected'],
											},
										},
										message: { type: 'string' },
									},
									required: ['status', 'message'],
								},
								render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
							},
							isConcurrencySafe: () => false,
							async execute(args, exec) {
								const sessionId = String(exec?.agent?.id ?? '');
								return askHuman({
									dispatch: sessionId === '' ? undefined : getDispatch(sessionId),
									token: workerToken,
									question: {
										question: String(args?.question ?? ''),
										...(Array.isArray(args?.options) ? { options: args.options } : {}),
									},
								});
							},
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
			ctx.effect(() =>
				ctx.on('api-session/added', (summary) => {
					const sessionId = String(summary?.sessionId ?? '');
					if (sessionId === '' || getDispatch(sessionId) === undefined) return;
					void armSession(sessionId);
				}),
			);
			// A session can appear again after its window was closed; parked
			// completion notices are delivered then instead of being lost.
			ctx.effect(() =>
				ctx.on('api-session/added', (summary) => {
					const sessionId = String(summary?.sessionId ?? '');
					if (sessionId === '') return;
					takePendingNotices(sessionId)
						.then(async (notices) => {
							if (resolved.wake === 'off') return;
							if (resolved.wake === 'silent') {
								const revived = ctx.agents.get(sessionId);
								if (revived !== undefined) wakeSilently(revived);
								return;
							}
							for (const notice of notices) {
								try {
									await ctx.sessionController.prompt(
										{
											requestId: randomUUID(),
											sessionId,
											mode: 'queue',
											content: [
												{
													type: 'text',
													text: `[设备舰队] ${notice.device} 上的会话 ${notice.sessionId} 已空闲（此通知在你不在时到达）。用 fleet_recent 读取结论（worker="${notice.device}", sessionId="${notice.sessionId}"）。`,
												},
											],
											clientTimeZone: 'Asia/Shanghai',
										},
										new AbortController().signal,
									);
								} catch {}
							}
						})
						.catch(() => {});
				}),
			);
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
