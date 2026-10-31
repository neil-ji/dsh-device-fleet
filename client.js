/**
 * 设备舰队 — 浏览器半端。
 *
 * 左侧栏独立面板（sidebar.panellist + main），与 bili-watch 同构：
 *   - 状态卡：角色 / 监听 / 密钥来源；
 *   - 配置卡：四个可写字段（写回 profile 的 cordis.patch.yml，立即生效）；
 *   - 设备卡：静态名单 + 组播发现的 worker。
 *
 * 数据全部来自宿主端点 /api/device-fleet（带页面令牌），前端不落任何凭证。
 * 密钥只写不读：表单里的 token 永远从空开始。
 */
window.__ModuleLoader__.load({
	id: 'dsh-device-fleet',
	factory: (require) => {
		const React = require('react')
		const h = React.createElement
		const { useCallback, useEffect, useState } = React

		const PANEL_ID = 'device-fleet'
		const API = '/api/device-fleet'
		const ROLES = [
			['worker+controller', '两半都开'],
			['worker', '仅 worker'],
			['controller', '仅 controller'],
		]

		const CSS = `
.fleet-page{max-width:900px;margin:0 auto;padding:28px 32px 48px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:18px}
.fleet-head{display:flex;align-items:flex-start;gap:12px}
.fleet-title{margin:0;font-size:20px;font-weight:600;line-height:28px}
.fleet-sub{margin:2px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.fleet-refresh{margin-left:auto;flex:0 0 auto}
.fleet-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.fleet-card{border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:4px;background:var(--dsw-alias-bg-base)}
.fleet-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.fleet-value{font-size:16px;line-height:24px;font-weight:600;word-break:break-all}
.fleet-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.fleet-panel{border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px;background:var(--dsw-alias-bg-base)}
.fleet-panel-head{display:flex;align-items:center;gap:10px}
.fleet-panel-title{margin:0;font-size:14px;font-weight:600;line-height:22px}
.fleet-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.fleet-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.fleet-field-wide{grid-column:1 / -1}
.fleet-input,.fleet-select{font:inherit;font-size:13px;line-height:20px;padding:6px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);min-width:0}
.fleet-input:focus,.fleet-select:focus{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.fleet-actions{display:flex;align-items:center;gap:10px}
.fleet-btn{font:inherit;font-size:13px;line-height:20px;padding:6px 14px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer}
.fleet-btn:hover{background:var(--dsw-alias-bg-l2)}
.fleet-btn-primary{border-color:transparent;background:var(--dsw-alias-state-business-primary);color:#fff}
.fleet-btn:disabled{opacity:.5;cursor:default}
.fleet-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin-left:auto}
.fleet-error{font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary)}
.fleet-ok{font-size:13px;line-height:20px;color:var(--dsw-alias-state-success-primary)}
.fleet-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.fleet-item{display:flex;align-items:baseline;gap:10px;font-size:13px;line-height:20px}
.fleet-item-name{font-weight:600}
.fleet-item-url{color:var(--dsw-alias-label-tertiary);word-break:break-all}
.fleet-tag{font-size:11px;padding:1px 7px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}
.fleet-empty{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.fleet-tasks{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.fleet-task{display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:center;gap:10px;padding:8px 4px;border-radius:8px;font-size:13px;line-height:20px}
.fleet-task:hover{background:var(--dsw-alias-bg-l2)}
.fleet-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto}
.fleet-dot.is-running{background:var(--dsw-alias-state-business-primary)}
.fleet-dot.is-done{background:var(--dsw-alias-state-success-primary)}
.fleet-dot.is-stale{background:var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary));opacity:.6}
.fleet-task-main{display:flex;align-items:baseline;gap:8px;min-width:0}
.fleet-task-device{font-weight:600;white-space:nowrap}
.fleet-task-id{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:12px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fleet-task-meta{display:flex;align-items:baseline;gap:8px;flex:0 0 auto}
.fleet-pill{font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.fleet-age{font-size:12px;color:var(--dsw-alias-label-tertiary);min-width:64px;text-align:right}
.fleet-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-state-business-primary);color:#fff;font-size:11px;font-weight:600}
`

		/** 页面令牌：宿主渲染 index.html 时注入；拿不到就只走回环 + 同源校验。 */
		function panelToken() {
			try {
				return typeof window === 'undefined' ? '' : String(window.__DSH_FLEET_TOKEN__ || '')
			} catch {
				return ''
			}
		}

		/** 调一次宿主端点，失败也返回结构化结果。 */
		async function api(path, body) {
			const headers = {}
			const token = panelToken()
			if (token) headers['x-fleet-token'] = token
			const init = { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers }
			if (body !== undefined) {
				headers['content-type'] = 'application/json'
				init.body = JSON.stringify(body)
			}
			let response
			try {
				response = await fetch(API + path, init)
			} catch (error) {
				return { ok: false, why: String(error?.message || error), status: 0 }
			}
			let json = null
			try {
				json = await response.json()
			} catch {}
			if (json === null) return { ok: false, why: `HTTP ${response.status}`, status: response.status }
			json.status = response.status
			return json
		}

		/** 一行状态卡。 */
		const TASK_STATUS = {
			running: { label: '运行中', dot: 'is-running' },
			done: { label: '已完成', dot: 'is-done' },
			stale: { label: '久未响应', dot: 'is-stale' },
		}

		/**
		 * Human-friendly age. Raw milliseconds are unreadable at a glance, and the
		 * exact timestamp is still shown on hover via the title attribute.
		 * @param {number} ms Age in milliseconds.
		 * @returns {string} Relative label.
		 */
		function relativeAge(ms) {
			if (!Number.isFinite(ms) || ms < 0) return '—'
			if (ms < 60_000) return '刚刚'
			if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分钟前`
			if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`
			return `${Math.floor(ms / 86_400_000)} 天前`
		}

		function Card(props) {
			return h(
				'div',
				{ className: 'fleet-card' },
				h('span', { className: 'fleet-label' }, props.label),
				h('span', { className: 'fleet-value' }, props.value),
				props.hint ? h('span', { className: 'fleet-hint' }, props.hint) : null,
			)
		}

		function Panel() {
			const [state, setState] = useState(null)
			const [error, setError] = useState('')
			const [notice, setNotice] = useState('')
			const [busy, setBusy] = useState('')
			const [form, setForm] = useState({ role: 'worker+controller', host: '', port: '', token: '' })

			const load = useCallback(async () => {
				const json = await api('/state')
				if (!json.ok) {
					setError(json.why || '读取状态失败')
					return
				}
				setError('')
				setState(json.data)
				setForm({
					role: json.data.role,
					host: json.data.host,
					port: String(json.data.port),
					token: '',
				})
			}, [])

			useEffect(() => {
				void load()
			}, [load])

			const save = useCallback(async () => {
				setBusy('save')
				setNotice('')
				const patch = { role: form.role, host: form.host.trim(), port: Number(form.port) }
				if (form.token !== '') patch.token = form.token
				const json = await api('/config', patch)
				setBusy('')
				if (!json.ok) {
					setError(json.why || '保存失败')
					return
				}
				setError('')
				setNotice('已保存，正在重新加载配置…')
				setTimeout(() => void load(), 400)
			}, [form, load])

			const scan = useCallback(async () => {
				setBusy('scan')
				setNotice('')
				const json = await api('/scan', {})
				setBusy('')
				if (!json.ok) {
					setError(json.why || '扫描失败')
					return
				}
				setError('')
				setNotice(`发现 ${json.data.discovered.length} 台设备`)
				void load()
			}, [load])

			if (error && state === null) {
				return h(
					'div',
					{ className: 'fleet-page' },
					h('h2', { className: 'fleet-title' }, '设备舰队'),
					h('p', { className: 'fleet-error' }, error),
					h('p', { className: 'fleet-hint' }, '如果这是从其它浏览器或局域网地址打开的页面，请改用 DSH 桌面窗口。'),
				)
			}

			const data = state
			const listening = data?.listening === true
			const keyHint =
				data?.tokenSource === 'explicit' ? '显式配置的共享密钥' : data?.tokenSource === 'generated' ? '首次激活自动生成' : '未就绪'
			const discovered = data?.discovered ?? []
			const workers = data?.workers ?? []
			const view = data?.view ?? { tasks: [], noticeCount: 0, recentNotices: [] }
			const tasks = view.tasks ?? []

			return h(
				'div',
				{ className: 'fleet-page' },
				h(
					'div',
					{ className: 'fleet-head' },
					h(
						'div',
						null,
						h('h2', { className: 'fleet-title' }, '设备舰队'),
						h('p', { className: 'fleet-sub' }, '把重任务交给局域网内其它机器上的 DSH：本地 Agent 用与 GUI 同语义的工具遥控远端工作区与会话。'),
					),
					h('button', { type: 'button', className: 'fleet-btn fleet-refresh', onClick: () => void load(), disabled: busy !== '' }, '刷新'),
				),
				h(
					'div',
					{ className: 'fleet-cards' },
					h(Card, { label: '角色', value: data?.role ?? '—' }),
					h(Card, {
						label: '监听',
						value: listening ? `${data?.host}:${data?.port}` : '未启动',
						hint: listening
							? `本机地址 ${data?.lan} · ${(data?.workersOnline ?? []).filter((worker) => worker.online).length}/${(data?.workersOnline ?? []).length || 1} 台在线`
							: 'worker 半端没有运行',
					}),
					h(Card, { label: '密钥', value: data?.tokenSet ? '已就绪' : '未就绪', hint: keyHint }),
				),
				h(
					'div',
					{ className: 'fleet-panel' },
					h(
						'div',
						{ className: 'fleet-panel-head' },
						h('h3', { className: 'fleet-panel-title' }, '任务'),
						view.noticeCount > 0
							? h('span', { className: 'fleet-badge', role: 'status', 'aria-atomic': 'true' }, String(view.noticeCount))
							: null,
						h(
							'span',
							{ className: 'fleet-note' },
							view.noticeCount > 0 ? `${view.noticeCount} 个任务已完成，等待 Agent 读取` : '派给其它机器的任务会出现在这里',
						),
					),
					tasks.length === 0
						? h('p', { className: 'fleet-empty' }, '还没有派发过任务。让 Agent 用 fleet_dispatch 把工作交给另一台机器。')
						: h(
								'ul',
								{ className: 'fleet-tasks' },
								tasks.map((task) =>
									h(
										'li',
										{ className: 'fleet-task', key: task.sessionId },
										h('span', { className: `fleet-dot ${(TASK_STATUS[task.status] || TASK_STATUS.running).dot}`, 'aria-hidden': 'true' }),
										h(
											'div',
											{ className: 'fleet-task-main' },
											h('span', { className: 'fleet-task-device' }, task.device),
											h('span', { className: 'fleet-task-id', title: task.sessionId }, task.shortId),
										),
										h(
											'div',
											{ className: 'fleet-task-meta' },
											h('span', { className: 'fleet-pill' }, (TASK_STATUS[task.status] || TASK_STATUS.running).label),
											h('span', { className: 'fleet-age', title: new Date(task.at).toLocaleString() }, relativeAge(task.ageMs)),
										),
									),
								),
							),
				),
				h(
					'div',
					{ className: 'fleet-panel' },
					h(
						'div',
						{ className: 'fleet-panel-head' },
						h('h3', { className: 'fleet-panel-title' }, '配置'),
						h('span', { className: 'fleet-note' }, '写入 profile 的 cordis.patch.yml，立即生效'),
					),
					h(
						'div',
						{ className: 'fleet-grid' },
						h(
							'label',
							{ className: 'fleet-field' },
							h('span', { className: 'fleet-label' }, '角色'),
							h(
								'select',
								{
									className: 'fleet-select',
									value: form.role,
									onChange: (event) => setForm((prev) => ({ ...prev, role: event.target.value })),
								},
								ROLES.map(([value, label]) => h('option', { key: value, value }, label)),
							),
						),
						h(
							'label',
							{ className: 'fleet-field' },
							h('span', { className: 'fleet-label' }, '监听地址'),
							h('input', {
								className: 'fleet-input',
								value: form.host,
								placeholder: '0.0.0.0',
								onChange: (event) => setForm((prev) => ({ ...prev, host: event.target.value })),
							}),
						),
						h(
							'label',
							{ className: 'fleet-field' },
							h('span', { className: 'fleet-label' }, '端口'),
							h('input', {
								className: 'fleet-input',
								value: form.port,
								inputMode: 'numeric',
								placeholder: '48791',
								onChange: (event) => setForm((prev) => ({ ...prev, port: event.target.value })),
							}),
						),
						h(
							'label',
							{ className: 'fleet-field' },
							h('span', { className: 'fleet-label' }, '共享密钥'),
							h('input', {
								className: 'fleet-input',
								type: 'password',
								value: form.token,
								placeholder: '留空保持不变',
								onChange: (event) => setForm((prev) => ({ ...prev, token: event.target.value })),
							}),
						),
					),
					h(
						'div',
						{ className: 'fleet-actions' },
						h('button', { type: 'button', className: 'fleet-btn fleet-btn-primary', onClick: () => void save(), disabled: busy !== '' }, busy === 'save' ? '保存中…' : '保存'),
						error ? h('span', { className: 'fleet-error' }, error) : null,
						!error && notice ? h('span', { className: 'fleet-ok' }, notice) : null,
					),
					h('span', { className: 'fleet-hint' }, '密钥只写不读：表单里永远是空的，留空即沿用当前值。留空时 worker 首次激活自动生成密钥，controller 首连通过 TOFU 自动配对。'),
				),
				h(
					'div',
					{ className: 'fleet-panel' },
					h(
						'div',
						{ className: 'fleet-panel-head' },
						h('h3', { className: 'fleet-panel-title' }, '设备'),
						h('span', { className: 'fleet-note' }, `${discovered.length} 台已发现 · ${workers.length} 条静态配置`),
						h(
							'button',
							{ type: 'button', className: 'fleet-btn', onClick: () => void scan(), disabled: busy !== '' },
							busy === 'scan' ? '扫描中…' : '扫描局域网',
						),
					),
					workers.length === 0 && discovered.length === 0
						? h('p', { className: 'fleet-empty' }, '还没有设备。让对端也装好本插件，然后点「扫描局域网」，或在对话里让 Agent 调 fleet_list_workers。')
						: h(
								'ul',
								{ className: 'fleet-list' },
								workers.map((worker) =>
									h(
										'li',
										{ key: `static:${worker.name}`, className: 'fleet-item' },
										h('span', { className: 'fleet-item-name' }, worker.name),
										h('span', { className: 'fleet-item-url' }, worker.url),
										h('span', { className: 'fleet-tag' }, '静态'),
									),
								),
								discovered.map((worker) =>
									h(
										'li',
										{ key: `found:${worker.name}`, className: 'fleet-item' },
										h('span', { className: 'fleet-item-name' }, worker.device || worker.name),
										h('span', { className: 'fleet-item-url' }, worker.url),
										h('span', { className: 'fleet-tag' }, '发现'),
									),
								),
							),
				),
			)
		}

		/** 左侧栏图标：三台设备连成一组。 */
		function PanelIcon() {
			return h(
				'svg',
				{ width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
				h('rect', { x: 2, y: 4, width: 20, height: 12, rx: 2, stroke: 'currentColor', 'stroke-width': 1.6 }),
				h('path', { d: 'M9 20h6M12 16v4', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
				h('path', { d: 'M6 10h3M10.5 10h3M15 10h3', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
			)
		}

		return {
			inject: ['slots'],
			apply(ctx) {
				const style = document.createElement('style')
				style.setAttribute('data-plugin-css', 'dsh-device-fleet')
				style.textContent = CSS
				document.head.appendChild(style)
				if (typeof ctx.effect === 'function') ctx.effect(() => () => style.remove(), 'device-fleet: 面板样式')

				const slots = ctx.slots
				slots.inject('sidebar.panellist', () =>
					slots.register(
						{
							name: 'sidebar.panellist',
							id: PANEL_ID,
							order: 21,
							label: () => '设备舰队',
						},
						PanelIcon,
					),
				)
				slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, Panel))
			},
		}
	},
})
