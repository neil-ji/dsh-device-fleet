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
					h(Card, { label: '监听', value: listening ? `${data?.host}:${data?.port}` : '未启动', hint: listening ? `本机地址 ${data?.lan}` : 'worker 半端没有运行' }),
					h(Card, { label: '密钥', value: data?.tokenSet ? '已就绪' : '未就绪', hint: keyHint }),
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
