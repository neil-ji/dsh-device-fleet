/**
 * 设备舰队 — 浏览器半端：舰队指挥舱。
 *
 * 视觉概念：深空座舱 / 指挥甲板。三块信息 —— 舰船（worker）、作战指令（派发
 * 的任务）、指挥参数（配置）—— 以遥测风格呈现，去掉通用 SaaS 卡片味。
 *
 * 数据全部来自宿主端点 /api/device-fleet（页面令牌）；装饰图由同一前缀的
 * /assets/ 白名单提供。前端不落任何凭证：识别码只写不读。
 */
window.__ModuleLoader__.load({
	id: 'dsh-device-fleet',
	factory: (require) => {
		const React = require('react')
		const h = React.createElement
		const { useCallback, useEffect, useRef, useState } = React

		const API = '/api/device-fleet'
		const ROLES = [
			['worker+controller', '旗舰 · 指挥 + 执行'],
			['worker', '执行舰 · 仅 worker'],
			['controller', '指挥舰 · 仅 controller'],
		]
		const ROLE_LABEL = {
			'worker+controller': '旗舰节点',
			worker: '执行舰',
			controller: '指挥舰',
		}
		const ORDER_STATUS = {
			running: { label: '执行中', tone: 'live' },
			done: { label: '已回报', tone: 'ok' },
			stale: { label: '迟滞', tone: 'warn' },
		}

		const CSS = `
.fleet-deck{position:relative;min-height:100%;color:#e6f1ff;background:#04070d;isolation:isolate}
.fleet-deck::before{content:"";position:absolute;inset:0;background-image:url('${API}/assets/space-bg.png');background-size:cover;background-position:center 35%;opacity:.85;z-index:-2}
.fleet-deck::after{content:"";position:absolute;inset:0;background:radial-gradient(120% 80% at 20% 0%,rgba(6,14,28,.35),rgba(4,7,13,.86) 62%,#04070d 100%);z-index:-1}
.fleet-hud{max-width:1080px;margin:0 auto;padding:26px 30px 56px;display:flex;flex-direction:column;gap:22px}
.fleet-mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-variant-numeric:tabular-nums}
.fleet-top{display:flex;align-items:center;gap:16px;padding-bottom:18px;border-bottom:1px solid rgba(120,190,255,.14)}
.fleet-sigil{width:56px;height:56px;flex:0 0 auto;background-image:url('${API}/assets/insignia.png');background-size:contain;background-repeat:no-repeat;background-position:center;mix-blend-mode:screen;filter:drop-shadow(0 0 10px rgba(85,230,210,.35))}
.fleet-id{min-width:0}
.fleet-kicker{margin:0;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#7c8fa6}
.fleet-title{margin:2px 0 0;font-size:22px;font-weight:600;letter-spacing:.06em;line-height:30px}
.fleet-sub{margin:4px 0 0;font-size:12.5px;line-height:19px;color:#8ea3ba;max-width:56ch}
.fleet-top-right{margin-left:auto;display:flex;align-items:center;gap:10px;flex:0 0 auto}
.fleet-clock{font-size:12px;color:#8ea3ba;letter-spacing:.08em}
.fleet-order-badge{display:inline-flex;align-items:center;gap:7px;padding:4px 11px;border:1px solid rgba(255,197,107,.45);border-radius:999px;color:#ffc56b;font-size:11.5px;letter-spacing:.1em;background:rgba(255,197,107,.07)}
.fleet-order-badge::before{content:"";width:6px;height:6px;border-radius:50%;background:#ffc56b;box-shadow:0 0 8px #ffc56b}
.fleet-btn{font:inherit;font-size:12.5px;letter-spacing:.08em;padding:6px 14px;border-radius:4px;border:1px solid rgba(120,190,255,.28);background:rgba(10,20,34,.7);color:#cfe2f6;cursor:pointer;transition:border-color .15s,background .15s,color .15s}
.fleet-btn:hover{background:rgba(20,36,58,.85);border-color:rgba(120,190,255,.5)}
.fleet-btn:focus-visible{outline:2px solid #55e6d2;outline-offset:2px}
.fleet-btn[disabled]{opacity:.45;cursor:default}
.fleet-btn-primary{border-color:transparent;background:#55e6d2;color:#04202a;font-weight:600}
.fleet-btn-primary:hover{background:#7ff0e0}
.fleet-telemetry{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:1px;background:rgba(120,190,255,.14);border:1px solid rgba(120,190,255,.14);border-radius:4px;overflow:hidden}
.fleet-gauge{background:#060b14;padding:12px 14px;display:flex;flex-direction:column;gap:3px;min-width:0}
.fleet-gauge-label{font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:#6f8298}
.fleet-gauge-value{font-size:15px;line-height:22px;color:#e6f1ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fleet-gauge-note{font-size:11.5px;color:#7c8fa6}
.fleet-online{color:#55e6d2}
.fleet-offline{color:#ff7b72}
.fleet-block{border:1px solid rgba(120,190,255,.14);border-radius:4px;background:rgba(6,11,20,.72)}
.fleet-block-head{display:flex;align-items:baseline;gap:10px;padding:13px 16px 11px;border-bottom:1px solid rgba(120,190,255,.1)}
.fleet-block-title{margin:0;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#9fb6cf}
.fleet-block-note{margin-left:auto;font-size:11.5px;color:#7c8fa6}
.fleet-ships{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;padding:14px 16px}
.fleet-ship{position:relative;display:flex;gap:12px;align-items:center;padding:10px 12px;border:1px solid rgba(120,190,255,.12);border-radius:4px;background:linear-gradient(180deg,rgba(12,22,38,.9),rgba(6,11,20,.9));min-width:0}
.fleet-ship.is-offline{opacity:.55}
.fleet-ship-art{width:74px;height:42px;flex:0 0 auto;background-image:url('${API}/assets/ship.png');background-size:contain;background-repeat:no-repeat;background-position:center;mix-blend-mode:screen;opacity:.9}
.fleet-ship-body{min-width:0;display:flex;flex-direction:column;gap:2px}
.fleet-ship-name{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fleet-ship-meta{font-size:11px;color:#7c8fa6;letter-spacing:.06em}
.fleet-orders{display:flex;flex-direction:column;margin:0;padding:6px 8px 10px;list-style:none}
.fleet-order{display:grid;grid-template-columns:14px 92px minmax(0,1fr) auto;align-items:center;gap:10px;padding:9px 8px;border-bottom:1px solid rgba(120,190,255,.06);font-size:13px}
.fleet-order:last-child{border-bottom:0}
.fleet-order:hover{background:rgba(120,190,255,.05)}
.fleet-sigil-dot{width:8px;height:8px;border-radius:50%;justify-self:center}
.fleet-sigil-dot.live{background:#55e6d2;box-shadow:0 0 10px #55e6d2;animation:fleet-pulse 2.4s ease-in-out infinite}
.fleet-sigil-dot.ok{background:#7bd88f}
.fleet-sigil-dot.warn{background:#ffc56b;box-shadow:0 0 8px rgba(255,197,107,.7)}
.fleet-order-code{font-size:11.5px;color:#8ea3ba;letter-spacing:.08em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fleet-order-main{display:flex;align-items:baseline;gap:10px;min-width:0}
.fleet-order-device{color:#e6f1ff;font-weight:600;white-space:nowrap}
.fleet-order-sub{font-size:11.5px;color:#6f8298;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fleet-order-right{display:flex;align-items:center;gap:12px;flex:0 0 auto}
.fleet-chip{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;padding:2px 8px;border:1px solid rgba(120,190,255,.22);border-radius:2px;color:#9fb6cf}
.fleet-chip.live{color:#55e6d2;border-color:rgba(85,230,210,.4)}
.fleet-chip.ok{color:#7bd88f;border-color:rgba(123,216,143,.4)}
.fleet-chip.warn{color:#ffc56b;border-color:rgba(255,197,107,.4)}
.fleet-age{font-size:11px;color:#6f8298;min-width:62px;text-align:right}
.fleet-empty{padding:20px 16px;margin:0;font-size:12.5px;line-height:20px;color:#7c8fa6}
.fleet-params{border:1px solid rgba(120,190,255,.14);border-radius:4px;background:rgba(6,11,20,.6)}
.fleet-params>summary{cursor:pointer;padding:12px 16px;font-size:11.5px;letter-spacing:.2em;text-transform:uppercase;color:#8ea3ba;list-style:none}
.fleet-params>summary::-webkit-details-marker{display:none}
.fleet-params>summary::before{content:"▸ ";color:#55e6d2}
.fleet-params[open]>summary::before{content:"▾ "}
.fleet-params-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;padding:4px 16px 16px}
.fleet-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.fleet-field-wide{grid-column:1/-1}
.fleet-label{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#6f8298}
.fleet-input,.fleet-select{font:inherit;font-size:13px;padding:7px 10px;border-radius:3px;border:1px solid rgba(120,190,255,.2);background:rgba(3,8,16,.9);color:#e6f1ff;min-width:0}
.fleet-input:focus-visible,.fleet-select:focus-visible{outline:2px solid #55e6d2;outline-offset:1px}
.fleet-actions{display:flex;align-items:center;gap:10px;grid-column:1/-1;margin-top:2px}
.fleet-error{font-size:12.5px;color:#ff7b72}
.fleet-ok{font-size:12.5px;color:#7bd88f}
.fleet-hint{font-size:11.5px;color:#6f8298;line-height:17px}
.fleet-foot{display:flex;flex-wrap:wrap;gap:14px;font-size:11px;letter-spacing:.1em;color:#5f7288;padding-top:6px;border-top:1px solid rgba(120,190,255,.1)}
@keyframes fleet-pulse{0%,100%{opacity:1;box-shadow:0 0 10px #55e6d2}50%{opacity:.45;box-shadow:0 0 4px #55e6d2}}
@media (prefers-reduced-motion:reduce){.fleet-sigil-dot.live{animation:none}}
@media (max-width:720px){.fleet-hud{padding:18px 16px 40px}.fleet-order{grid-template-columns:14px minmax(0,1fr) auto}.fleet-order-code{display:none}}
`

		/** Page token injected by the host into index.html. */
		function panelToken() {
			return typeof window !== 'undefined' && typeof window.__DSH_FLEET_TOKEN__ === 'string' ? window.__DSH_FLEET_TOKEN__ : ''
		}

		/**
		 * Call the panel endpoint.
		 * @param {string} path Path under the panel prefix.
		 * @param {Record<string, unknown>} [body] JSON body for a write.
		 * @returns {Promise<any>} Parsed response, or `{ok:false}` on transport failure.
		 */
		async function api(path, body) {
			try {
				const token = panelToken()
				const response = await fetch(`${API}${path}`, {
					method: body === undefined ? 'GET' : 'POST',
					credentials: 'same-origin',
					headers: {
						...(token === '' ? {} : { 'x-fleet-token': token }),
						...(body === undefined ? {} : { 'content-type': 'application/json' }),
					},
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				})
				return await response.json()
			} catch {
				return { ok: false, why: '面板端点不可达' }
			}
		}

		/**
		 * Human-friendly age; the exact time stays available in a title tooltip.
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

		/** Short mission code from a session id, e.g. ORD·4E84AF8. */
		function orderCode(shortId) {
			return `ORD·${String(shortId || '').toUpperCase()}`
		}

		/**
		 * One ship entry for a worker in the fleet.
		 * @param {{ worker: Record<string, any> }} props Component props.
		 */
		function Ship(props) {
			const worker = props.worker || {}
			const online = worker.online === true
			const latency = typeof worker.latencyMs === 'number' && worker.latencyMs > 0 ? `${worker.latencyMs} ms` : '本机'
			return h(
				'div',
				{ className: `fleet-ship${online ? '' : ' is-offline'}` },
				h('span', { className: 'fleet-ship-art', 'aria-hidden': 'true' }),
				h(
					'div',
					{ className: 'fleet-ship-body' },
					h('span', { className: 'fleet-ship-name' }, String(worker.name || '未命名节点')),
					h(
						'span',
						{ className: 'fleet-ship-meta fleet-mono' },
						online ? h('span', { className: 'fleet-online' }, '在线') : h('span', { className: 'fleet-offline' }, '失联'),
						' · 信号 ',
						latency,
					),
				),
			)
		}

		function Deck() {
			const [state, setState] = useState(null)
			const [error, setError] = useState('')
			const [notice, setNotice] = useState('')
			const [busy, setBusy] = useState('')
			const [clock, setClock] = useState(() => new Date())
			const [form, setForm] = useState({ role: 'worker+controller', host: '', port: '', token: '' })
			const alive = useRef(true)

			const load = useCallback(async () => {
				const json = await api('/state')
				if (!alive.current) return
				if (!json.ok) {
					setError(json.why || '读取状态失败')
					return
				}
				setError('')
				setState(json.data)
				setForm((current) => ({
					role: json.data.role,
					host: json.data.host,
					port: String(json.data.port),
					token: current.token,
				}))
			}, [])

			useEffect(() => {
				alive.current = true
				void load()
				// A console should look alive: refresh telemetry on a slow beat.
				const beat = setInterval(() => {
					if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
					void load()
				}, 20_000)
				const tick = setInterval(() => setClock(new Date()), 1_000)
				return () => {
					alive.current = false
					clearInterval(beat)
					clearInterval(tick)
				}
			}, [load])

			const save = useCallback(async () => {
				setBusy('save')
				setNotice('')
				const patch = { role: form.role, host: form.host.trim(), port: Number(form.port) }
				if (form.token !== '') patch.token = form.token
				const json = await api('/config', patch)
				setBusy('')
				if (!json.ok) {
					setError(json.why || '写入失败')
					return
				}
				setError('')
				setNotice('命令已下达：配置重载中…')
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
				setNotice(`扫描完成：捕获 ${json.data.discovered.length} 个信号源`)
				void load()
			}, [load])

			if (error && state === null) {
				return h(
					'div',
					{ className: 'fleet-deck' },
					h(
						'div',
						{ className: 'fleet-hud' },
						h('h2', { className: 'fleet-title' }, '设备舰队'),
						h('p', { className: 'fleet-error' }, error),
						h('p', { className: 'fleet-hint' }, '若这是从局域网其它地址打开的页面，请改用 DSH 桌面窗口访问。'),
					),
				)
			}

			const data = state || {}
			const listening = data.listening === true
			const view = data.view || { tasks: [], noticeCount: 0 }
			const tasks = view.tasks || []
			const workers = data.workersOnline || []
			const onlineCount = workers.filter((worker) => worker.online).length
			const keyHint = data.tokenSource === 'explicit' ? '显式配置' : data.tokenSource === 'generated' ? '自动生成' : '未就绪'
			const utc = clock.toISOString().slice(11, 19)

			return h(
				'div',
				{ className: 'fleet-deck' },
				h(
					'div',
					{ className: 'fleet-hud' },
					h(
						'header',
						{ className: 'fleet-top' },
						h('span', { className: 'fleet-sigil', 'aria-hidden': 'true' }),
						h(
							'div',
							{ className: 'fleet-id' },
							h('p', { className: 'fleet-kicker fleet-mono' }, 'Fleet Command · Command Deck'),
							h('h2', { className: 'fleet-title' }, '舰队指挥舱'),
							h('p', { className: 'fleet-sub' }, '把重任务派给局域网内其它机器上的 DSH：本机 Agent 用与 GUI 同语义的指令遥控远端工作区与会话，完成后自动回报。'),
						),
						h(
							'div',
							{ className: 'fleet-top-right' },
							view.noticeCount > 0
								? h('span', { className: 'fleet-order-badge', role: 'status', 'aria-atomic': 'true' }, `${view.noticeCount} 份战报待接收`)
								: null,
							h('span', { className: 'fleet-clock fleet-mono', title: 'UTC' }, `${utc}Z`),
							h('button', { type: 'button', className: 'fleet-btn', onClick: () => void load(), disabled: busy !== '' }, '重新扫描遥测'),
						),
					),
					h(
						'div',
						{ className: 'fleet-telemetry' },
						h(
							'div',
							{ className: 'fleet-gauge' },
							h('span', { className: 'fleet-gauge-label' }, '编队角色'),
							h('span', { className: 'fleet-gauge-value' }, ROLE_LABEL[data.role] || data.role || '—'),
							h('span', { className: 'fleet-gauge-note fleet-mono' }, `本节点 ${data.deviceName || '未命名'}`),
						),
						h(
							'div',
							{ className: 'fleet-gauge' },
							h('span', { className: 'fleet-gauge-label' }, '通讯阵列'),
							h(
								'span',
								{ className: 'fleet-gauge-value' },
								listening ? h('span', { className: 'fleet-online' }, '· 上线') : h('span', { className: 'fleet-offline' }, '· 离线'),
								h('span', { className: 'fleet-mono', style: { fontSize: '12px', color: '#7c8fa6', marginLeft: '8px' } }, `${data.host}:${data.port}`),
							),
							h('span', { className: 'fleet-gauge-note fleet-mono' }, `频段 ${data.lan || '—'}`),
						),
						h(
							'div',
							{ className: 'fleet-gauge' },
							h('span', { className: 'fleet-gauge-label' }, '在编舰船'),
							h('span', { className: 'fleet-gauge-value fleet-mono' }, `${onlineCount}/${workers.length || 1} 在线`),
							h('span', { className: 'fleet-gauge-note fleet-mono' }, `主机负载 ${data.load ? `${data.load.load1m} / ${data.load.cpus}c` : '—'}`),
						),
						h(
							'div',
							{ className: 'fleet-gauge' },
							h('span', { className: 'fleet-gauge-label' }, '识别码'),
							h('span', { className: 'fleet-gauge-value' }, data.tokenSet ? h('span', { className: 'fleet-online' }, '· 已就绪') : h('span', { className: 'fleet-offline' }, '· 未就绪')),
							h('span', { className: 'fleet-gauge-note' }, keyHint),
						),
					),
					h(
						'section',
						{ className: 'fleet-block' },
						h(
							'div',
							{ className: 'fleet-block-head' },
							h('h3', { className: 'fleet-block-title' }, '舰船'),
							h('span', { className: 'fleet-block-note fleet-mono' }, `${workers.length} 单位`),
						),
						workers.length === 0
							? h('p', { className: 'fleet-empty' }, '编队为空：尚未配对任何 worker。用「扫描编队」捕获局域网内的信号源。')
							: h('div', { className: 'fleet-ships' }, workers.map((worker) => h(Ship, { key: worker.name, worker }))),
					),
					h(
						'section',
						{ className: 'fleet-block' },
						h(
							'div',
							{ className: 'fleet-block-head' },
							h('h3', { className: 'fleet-block-title' }, '作战指令'),
							h('span', { className: 'fleet-block-note fleet-mono' }, tasks.length === 0 ? '待命' : `${tasks.length} 条`),
						),
						tasks.length === 0
							? h('p', { className: 'fleet-empty' }, '尚无派发记录。让 Agent 用 fleet_dispatch 把任务交给另一台机器，指令会在这里排队并回传战报。')
							: h(
									'ul',
									{ className: 'fleet-orders' },
									tasks.map((task) => {
										const meta = ORDER_STATUS[task.status] || ORDER_STATUS.running
										return h(
											'li',
											{ className: 'fleet-order', key: task.sessionId },
											h('span', { className: `fleet-sigil-dot ${meta.tone}`, 'aria-hidden': 'true' }),
											h('span', { className: 'fleet-order-code fleet-mono', title: task.sessionId }, orderCode(task.shortId)),
											h(
												'div',
												{ className: 'fleet-order-main' },
												h('span', { className: 'fleet-order-device' }, task.device || '未知节点'),
												h('span', { className: 'fleet-order-sub fleet-mono' }, 'session'),
											),
											h(
												'div',
												{ className: 'fleet-order-right' },
												h('span', { className: `fleet-chip ${meta.tone}` }, meta.label),
												h('span', { className: 'fleet-age fleet-mono', title: new Date(task.at).toLocaleString() }, relativeAge(task.ageMs)),
											),
										)
									}),
								),
					),
					h(
						'details',
						{ className: 'fleet-params' },
						h('summary', null, '指挥参数'),
						h(
							'div',
							{ className: 'fleet-params-body' },
							h(
								'label',
								{ className: 'fleet-field' },
								h('span', { className: 'fleet-label' }, '编队角色'),
								h(
									'select',
									{ className: 'fleet-select', value: form.role, onChange: (event) => setForm({ ...form, role: event.target.value }) },
									ROLES.map(([value, label]) => h('option', { key: value, value }, label)),
								),
							),
							h(
								'label',
								{ className: 'fleet-field' },
								h('span', { className: 'fleet-label' }, '监听地址'),
								h('input', { className: 'fleet-input fleet-mono', value: form.host, onChange: (event) => setForm({ ...form, host: event.target.value }) }),
							),
							h(
								'label',
								{ className: 'fleet-field' },
								h('span', { className: 'fleet-label' }, '端口'),
								h('input', {
									className: 'fleet-input fleet-mono',
									value: form.port,
									inputMode: 'numeric',
									onChange: (event) => setForm({ ...form, port: event.target.value }),
								}),
							),
							h(
								'label',
								{ className: 'fleet-field' },
								h('span', { className: 'fleet-label' }, '识别码'),
								h('input', {
									className: 'fleet-input fleet-mono',
									type: 'password',
									value: form.token,
									placeholder: '留空表示不改动',
									onChange: (event) => setForm({ ...form, token: event.target.value }),
								}),
							),
							h(
								'div',
								{ className: 'fleet-actions' },
								h('button', { type: 'button', className: 'fleet-btn fleet-btn-primary', onClick: () => void save(), disabled: busy !== '' }, busy === 'save' ? '下达中…' : '下达指令'),
								h('button', { type: 'button', className: 'fleet-btn', onClick: () => void scan(), disabled: busy !== '' }, busy === 'scan' ? '扫描中…' : '扫描编队'),
								error ? h('span', { className: 'fleet-error', role: 'alert' }, error) : null,
								notice ? h('span', { className: 'fleet-ok', role: 'status' }, notice) : null,
							),
							h('p', { className: 'fleet-hint fleet-field-wide' }, '写入 profile 的 cordis.patch.yml 并立即重载；识别码只写不读。'),
						),
					),
					h(
						'footer',
						{ className: 'fleet-foot fleet-mono' },
						h('span', null, `NODE ${data.deviceName || '—'}`),
						h('span', null, `CHANNEL ${data.lan || '—'}:${data.port || '—'}`),
						h('span', null, `KEYS ${data.tokenSet ? 'READY' : 'MISSING'}`),
						h('span', null, `TASKS ${tasks.length}`),
					),
				),
			)
		}

		/** Sidebar glyph: a radar dish silhouette on a 24px grid. */
		function DeckIcon() {
			return h(
				'svg',
				{ width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' },
				h('circle', { cx: 10, cy: 10, r: 7, stroke: 'currentColor', 'stroke-width': 1.4, opacity: 0.55 }),
				h('path', { d: 'M10 10 15 5', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
				h('circle', { cx: 10, cy: 10, r: 1.6, fill: 'currentColor' }),
				h('path', { d: 'M4 16h12', stroke: 'currentColor', 'stroke-width': 1.2, opacity: 0.4 }),
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
							id: 'device-fleet',
							order: 21,
							label: () => '设备舰队',
						},
						DeckIcon,
					),
				)
				slots.inject('main', () => slots.register({ name: 'main', key: 'device-fleet' }, Deck))
			},
		}
	},
})
