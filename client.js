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
.fleet-deck{position:relative;min-height:100vh;color:#e9f2fb;background:#04070d;overflow-x:hidden}
.fleet-deck::before{content:"";position:fixed;inset:0;background-image:url('${API}/assets/space-bg.png');background-size:cover;background-position:74% 40%;opacity:.96;z-index:-2}
.fleet-deck::after{content:"";position:fixed;inset:0;z-index:-1;background:repeating-linear-gradient(0deg,rgba(130,200,255,.022) 0 1px,transparent 1px 3px),radial-gradient(130% 100% at 10% 6%,rgba(10,22,40,.12),rgba(4,7,13,.42) 52%,rgba(3,6,11,.78) 100%)}
.fleet-hud{max-width:1160px;margin:0 auto;padding:30px 34px 64px;display:flex;flex-direction:column;gap:24px}
.fleet-mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-variant-numeric:tabular-nums}
.fleet-top{display:flex;align-items:center;gap:18px;padding-bottom:20px;border-bottom:1px solid rgba(120,190,255,.16)}
.fleet-sigil{width:76px;height:76px;flex:0 0 auto;background-image:url('${API}/assets/insignia.png');background-size:contain;background-repeat:no-repeat;background-position:center;mix-blend-mode:screen;filter:drop-shadow(0 0 16px rgba(85,230,210,.5))}
.fleet-id{min-width:0}
.fleet-kicker{margin:0;font-size:10.5px;letter-spacing:.26em;text-transform:uppercase;color:#7f9ab5}
.fleet-title{margin:3px 0 0;font-size:26px;font-weight:600;letter-spacing:.08em;line-height:32px;text-shadow:0 0 22px rgba(85,230,210,.18)}
.fleet-sub{margin:5px 0 0;font-size:12.5px;line-height:19px;color:#93a9c0;max-width:60ch}
.fleet-top-right{margin-left:auto;display:flex;align-items:center;gap:12px;flex:0 0 auto}
.fleet-clock{font-size:12.5px;color:#a8bdd3;letter-spacing:.12em}
.fleet-order-badge{display:inline-flex;align-items:center;gap:8px;padding:5px 12px;border:1px solid rgba(255,197,107,.5);border-radius:2px;color:#ffc56b;font-size:11px;letter-spacing:.14em;background:rgba(255,197,107,.08);text-transform:uppercase}
.fleet-order-badge::before{content:"";width:6px;height:6px;border-radius:50%;background:#ffc56b;box-shadow:0 0 10px #ffc56b}
.fleet-btn{font:inherit;font-size:12.5px;letter-spacing:.1em;padding:7px 15px;border-radius:2px;border:1px solid rgba(120,190,255,.32);background:rgba(10,20,34,.72);color:#d6e6f7;cursor:pointer;transition:border-color .15s,background .15s}
.fleet-btn:hover{background:rgba(24,44,70,.9);border-color:rgba(120,190,255,.6)}
.fleet-btn:focus-visible{outline:2px solid #55e6d2;outline-offset:2px}
.fleet-btn[disabled]{opacity:.45;cursor:default}
.fleet-btn-primary{border-color:transparent;background:#55e6d2;color:#04202a;font-weight:600}
.fleet-btn-primary:hover{background:#83f2e2}
.fleet-telemetry{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:0}
.fleet-gauge{padding:14px 20px 14px 18px;display:flex;flex-direction:column;gap:4px;min-width:0;border-left:2px solid rgba(85,230,210,.35)}
.fleet-gauge+.fleet-gauge{border-left-color:rgba(120,190,255,.16)}
.fleet-gauge-label{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#6b809a}
.fleet-gauge-value{font-size:16px;line-height:24px;color:#eef6ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fleet-gauge-note{font-size:11.5px;color:#7f95ac}
.fleet-online{color:#55e6d2}
.fleet-offline{color:#ff7b72}
.fleet-block{border:1px solid rgba(120,190,255,.13);border-radius:3px;background:rgba(5,10,18,.55)}
.fleet-block-head{display:flex;align-items:baseline;gap:10px;padding:13px 18px 11px;border-bottom:1px solid rgba(120,190,255,.1)}
.fleet-block-title{margin:0;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#a6bcd4}
.fleet-block-note{margin-left:auto;font-size:11px;color:#7f95ac;letter-spacing:.1em}
.fleet-ships{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;padding:16px 18px}
.fleet-ship{position:relative;display:flex;gap:14px;align-items:center;padding:12px 14px;border:1px solid rgba(120,190,255,.14);border-left:2px solid rgba(85,230,210,.55);border-radius:2px;background:linear-gradient(120deg,rgba(12,24,40,.92),rgba(6,12,22,.82));min-width:0}
.fleet-ship.is-offline{opacity:.5;border-left-color:rgba(255,123,114,.6)}
.fleet-ship-art{width:104px;height:58px;flex:0 0 auto;background-image:url('${API}/assets/ship.png');background-size:contain;background-repeat:no-repeat;background-position:center;mix-blend-mode:screen;filter:brightness(1.5) contrast(1.15) drop-shadow(0 0 14px rgba(85,230,210,.22))}
.fleet-ship-body{min-width:0;display:flex;flex-direction:column;gap:4px;flex:1 1 auto}
.fleet-ship-name{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.02em}
.fleet-ship-meta{font-size:11px;color:#8299b0;letter-spacing:.08em;display:flex;align-items:center;gap:8px}
.fleet-bars{display:flex;align-items:flex-end;gap:2px;height:13px}
.fleet-bars i{display:block;width:3px;background:#55e6d2;border-radius:1px;opacity:.9}
.fleet-bars i:nth-child(1){height:5px}.fleet-bars i:nth-child(2){height:8px}.fleet-bars i:nth-child(3){height:11px}.fleet-bars i:nth-child(4){height:13px}
.fleet-bars.is-low i{background:#ffc56b;opacity:.6}
.fleet-orders{display:flex;flex-direction:column;margin:0;padding:4px 10px 8px;list-style:none}
.fleet-order{display:grid;grid-template-columns:16px 112px minmax(0,1fr) auto;align-items:center;gap:12px;padding:11px 10px;border-bottom:1px solid rgba(120,190,255,.055);font-size:13px}
.fleet-order:last-child{border-bottom:0}
.fleet-order:hover{background:rgba(120,190,255,.045)}
.fleet-sigil-dot{width:7px;height:7px;border-radius:50%;justify-self:center}
.fleet-sigil-dot.live{background:#55e6d2;box-shadow:0 0 12px #55e6d2;animation:fleet-pulse 2.4s ease-in-out infinite}
.fleet-sigil-dot.ok{background:#6fdc8c}
.fleet-sigil-dot.warn{background:#ffc56b;box-shadow:0 0 9px rgba(255,197,107,.75)}
.fleet-order-code{font-size:11.5px;color:#9db4cc;letter-spacing:.1em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fleet-order-main{display:flex;align-items:baseline;gap:8px;min-width:0}
.fleet-order-device{color:#eef6ff;font-weight:600;white-space:nowrap}
.fleet-order-sub{font-size:11px;color:#6b809a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fleet-order-right{display:flex;align-items:center;gap:14px;flex:0 0 auto}
.fleet-chip{font-size:10px;letter-spacing:.16em;text-transform:uppercase;padding:3px 9px;border:1px solid rgba(120,190,255,.25);border-radius:2px;color:#a6bcd4;white-space:nowrap}
.fleet-chip.live{color:#55e6d2;border-color:rgba(85,230,210,.45);background:rgba(85,230,210,.06)}
.fleet-chip.ok{color:#6fdc8c;border-color:rgba(111,220,140,.42);background:rgba(111,220,140,.06)}
.fleet-chip.warn{color:#ffc56b;border-color:rgba(255,197,107,.45);background:rgba(255,197,107,.06)}
.fleet-age{font-size:11px;color:#7590a8;min-width:66px;text-align:right}
.fleet-empty{padding:22px 18px;margin:0;font-size:12.5px;line-height:20px;color:#7f95ac}
.fleet-params{border:1px solid rgba(120,190,255,.13);border-radius:3px;background:rgba(5,10,18,.5)}
.fleet-params>summary{cursor:pointer;padding:13px 18px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#93a9c0;list-style:none}
.fleet-params>summary::-webkit-details-marker{display:none}
.fleet-params>summary::before{content:"▸ ";color:#55e6d2}
.fleet-params[open]>summary::before{content:"▾ "}
.fleet-params-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;padding:6px 18px 18px}
.fleet-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.fleet-field-wide{grid-column:1/-1}
.fleet-label{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#6b809a}
.fleet-input,.fleet-select{font:inherit;font-size:13px;padding:8px 11px;border-radius:2px;border:1px solid rgba(120,190,255,.2);background:rgba(3,8,16,.92);color:#eef6ff;min-width:0}
.fleet-input:focus-visible,.fleet-select:focus-visible{outline:2px solid #55e6d2;outline-offset:1px}
.fleet-actions{display:flex;align-items:center;gap:12px;grid-column:1/-1;margin-top:2px}
.fleet-error{font-size:12.5px;color:#ff7b72}
.fleet-ok{font-size:12.5px;color:#6fdc8c}
.fleet-hint{font-size:11.5px;color:#6b809a;line-height:17px}
.fleet-foot{display:flex;flex-wrap:wrap;gap:18px;font-size:10.5px;letter-spacing:.14em;color:#68809a;padding-top:10px;border-top:1px solid rgba(120,190,255,.1)}
@keyframes fleet-pulse{0%,100%{opacity:1;box-shadow:0 0 12px #55e6d2}50%{opacity:.4;box-shadow:0 0 4px #55e6d2}}
@media (prefers-reduced-motion:reduce){.fleet-sigil-dot.live{animation:none}}
@media (max-width:760px){.fleet-hud{padding:20px 16px 44px}.fleet-order{grid-template-columns:14px minmax(0,1fr) auto}.fleet-order-code{display:none}.fleet-ship-art{width:76px;height:44px}}
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
						' · ',
						latency,
					),
				),
				h(
					'span',
					{ className: `fleet-bars${online && typeof worker.latencyMs === 'number' && worker.latencyMs > 40 ? ' is-low' : ''}`, 'aria-hidden': 'true' },
					h('i'),
					h('i'),
					h('i'),
					h('i'),
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
												h('span', { className: 'fleet-order-sub fleet-mono', title: task.sessionId }, `→ ${String(task.shortId || '').toUpperCase()}`),
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
