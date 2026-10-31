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
.fleet-deck{position:relative;min-height:100vh;background:#05070a;color:#c8d6c9;overflow-x:hidden;font-size:13px}
.fleet-deck::before{content:"";position:fixed;inset:0;z-index:-3;background:#05070a url('${API}/assets/space-bg.png') center 45%/cover no-repeat;opacity:.5;filter:saturate(.85) contrast(1.05)}
.fleet-deck::after{content:"";position:fixed;inset:0;z-index:-2;background:radial-gradient(115% 85% at 50% 40%,rgba(5,7,10,.25),rgba(5,7,10,.72) 58%,#05070a 100%),repeating-linear-gradient(0deg,rgba(140,240,176,.028) 0 1px,transparent 1px 3px)}
.fleet-grid{position:fixed;inset:0;z-index:-1;pointer-events:none;background-image:linear-gradient(rgba(140,240,176,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(140,240,176,.045) 1px,transparent 1px);background-size:64px 64px;mask-image:radial-gradient(90% 70% at 50% 30%,#000 20%,transparent 85%)}
.fleet-hud{position:relative;max-width:1200px;margin:0 auto;padding:0 26px 40px;display:flex;flex-direction:column}
.fleet-online{color:#8cf0b0}
.fleet-offline{color:#ff8a80}
.fleet-mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-variant-numeric:tabular-nums}
/* ---- 顶部状态条 ---- */
.fleet-strip{display:flex;align-items:center;gap:0;border-bottom:1px solid rgba(140,240,176,.22);padding:9px 0;font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:#7d8f80}
.fleet-strip-cell{padding:0 16px;border-right:1px solid rgba(140,240,176,.16);white-space:nowrap}
.fleet-strip-cell:first-child{padding-left:0}
.fleet-strip-cell:last-child{border-right:0;margin-left:auto;padding-right:0}
.fleet-strip b{color:#a9bdaa;font-weight:500}
/* ---- 头部 ---- */
.fleet-top{display:flex;align-items:center;gap:16px;padding:20px 0 16px;border-bottom:1px solid rgba(140,240,176,.14)}
.fleet-sigil{width:52px;height:52px;flex:0 0 auto;background:url('${API}/assets/insignia.png') center/contain no-repeat;mix-blend-mode:screen;opacity:.85;filter:hue-rotate(-28deg) saturate(1.1)}
.fleet-id{min-width:0}
.fleet-kicker{margin:0;font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:#6f8072}
.fleet-title{margin:2px 0 0;font-size:22px;font-weight:600;letter-spacing:.16em;line-height:28px;color:#dcebdd}
.fleet-sub{margin:3px 0 0;font-size:12px;line-height:18px;color:#8a9b8c;max-width:64ch;letter-spacing:.01em}
.fleet-top-right{margin-left:auto;display:flex;align-items:center;gap:10px;flex:0 0 auto}
.fleet-badge{display:inline-flex;align-items:center;gap:7px;padding:4px 10px;border:1px solid rgba(242,193,78,.5);color:#f2c14e;font-size:10px;letter-spacing:.16em;text-transform:uppercase;background:rgba(242,193,78,.07)}
.fleet-badge::before{content:"";width:5px;height:5px;background:#f2c14e;box-shadow:0 0 6px rgba(242,193,78,.8)}
/* ---- 按钮 ---- */
.fleet-btn{font:inherit;font-size:11px;letter-spacing:.16em;text-transform:uppercase;padding:6px 13px;border:1px solid rgba(140,240,176,.3);background:rgba(140,240,176,.04);color:#a9bdaa;cursor:pointer;transition:background .12s,color .12s,border-color .12s}
.fleet-btn:hover{background:rgba(140,240,176,.12);color:#dcebdd;border-color:rgba(140,240,176,.5)}
.fleet-btn:focus-visible{outline:1px solid #8cf0b0;outline-offset:2px}
.fleet-btn[disabled]{opacity:.4;cursor:default}
.fleet-btn-primary{border-color:#8cf0b0;background:#8cf0b0;color:#05070a;font-weight:700}
.fleet-btn-primary:hover{background:#a6f5c2;border-color:#a6f5c2;color:#05070a}
/* ---- 主区两栏 ---- */
.fleet-main{display:grid;grid-template-columns:minmax(260px,340px) minmax(0,1fr);gap:0;border-bottom:1px solid rgba(140,240,176,.14)}
.fleet-col{padding:14px 0 16px;min-width:0}
.fleet-col+.fleet-col{border-left:1px solid rgba(140,240,176,.14);padding-left:20px;margin-left:20px}
.fleet-col--rail{padding-right:20px}
.fleet-head{display:flex;align-items:baseline;gap:8px;margin-bottom:10px}
.fleet-head h3{margin:0;font-size:10px;letter-spacing:.28em;text-transform:uppercase;color:#8fa591;font-weight:500}
.fleet-head span{margin-left:auto;font-size:10px;letter-spacing:.14em;color:#6f8072}
/* ---- 舰船名册 ---- */
.fleet-roster{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.fleet-ship{display:grid;grid-template-columns:22px 1fr auto;align-items:center;gap:9px;padding:8px 6px;border-bottom:1px solid rgba(140,240,176,.08);font-size:12.5px}
.fleet-ship:last-child{border-bottom:0}
.fleet-ship:hover{background:rgba(140,240,176,.05)}
.fleet-ship-no{font-size:10px;color:#5f7062;letter-spacing:.1em}
.fleet-ship-name{color:#cfe0d1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fleet-ship-name.is-offline{color:#7c6666}
.fleet-glyphs{display:flex;align-items:flex-end;gap:2px;height:11px}
.fleet-glyphs i{display:block;width:2px;background:#6fbf86;opacity:.85}
.fleet-glyphs i:nth-child(1){height:4px}.fleet-glyphs i:nth-child(2){height:7px}.fleet-glyphs i:nth-child(3){height:11px}
.fleet-glyphs.is-down i{background:#c2554f;opacity:.55}
.fleet-ship-art{width:56px;height:30px;flex:0 0 auto;background:url('${API}/assets/ship.png') center/contain no-repeat;mix-blend-mode:screen;opacity:.55;filter:brightness(1.4)}
.fleet-ship-lat{font-size:10px;color:#6f8072;letter-spacing:.08em;text-align:right;min-width:46px}
/* ---- 作战指令 ---- */
.fleet-orders{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.fleet-order{display:grid;grid-template-columns:14px 104px minmax(0,1fr) auto;align-items:center;gap:11px;padding:9px 6px;border-bottom:1px solid rgba(140,240,176,.08);font-size:12.5px}
.fleet-order:last-child{border-bottom:0}
.fleet-order:hover{background:rgba(140,240,176,.05)}
.fleet-order.is-selected{background:rgba(140,240,176,.09);box-shadow:inset 2px 0 0 #8cf0b0}
.fleet-dot{width:6px;height:6px;justify-self:center}
.fleet-dot.live{background:#8cf0b0;animation:fleet-blink 1.6s steps(2,end) infinite}
.fleet-dot.ok{background:#6fbf86}
.fleet-dot.warn{background:#f2c14e}
.fleet-dot.dead{background:#c2554f}
.fleet-order-code{font-size:10.5px;color:#8fa591;letter-spacing:.12em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fleet-order-main{display:flex;align-items:baseline;gap:9px;min-width:0}
.fleet-order-device{color:#dcebdd;white-space:nowrap}
.fleet-order-sub{font-size:10.5px;color:#6f8072;letter-spacing:.06em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fleet-order-right{display:flex;align-items:center;gap:12px;flex:0 0 auto}
.fleet-state{font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;padding:2px 7px;border:1px solid rgba(140,240,176,.22);color:#8fa591;white-space:nowrap}
.fleet-state.live{color:#8cf0b0;border-color:rgba(140,240,176,.45)}
.fleet-state.ok{color:#6fbf86;border-color:rgba(111,191,134,.4)}
.fleet-state.warn{color:#f2c14e;border-color:rgba(242,193,78,.45)}
.fleet-age{font-size:10px;color:#6f8072;min-width:60px;text-align:right;letter-spacing:.06em}
.fleet-empty{margin:0;padding:16px 6px;font-size:12px;line-height:19px;color:#748577}
/* ---- 底部战报 ---- */
.fleet-report{border-bottom:1px solid rgba(140,240,176,.14);padding:14px 0 16px}
.fleet-report-body{margin:0;font-size:12px;line-height:19px;color:#a7b8a9;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto;border-left:2px solid rgba(140,240,176,.35);padding-left:12px}
.fleet-report-body.is-empty{color:#6f8072;border-left-color:rgba(140,240,176,.15)}
/* ---- 参数 ---- */
.fleet-params{margin-top:14px;border-top:1px solid rgba(140,240,176,.14)}
.fleet-params>summary{cursor:pointer;padding:12px 0;font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:#8fa591;list-style:none}
.fleet-params>summary::-webkit-details-marker{display:none}
.fleet-params>summary::before{content:"[+] ";color:#6fbf86}
.fleet-params[open]>summary::before{content:"[−] "}
.fleet-params-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;padding:2px 0 16px}
.fleet-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.fleet-field-wide{grid-column:1/-1}
.fleet-label{font-size:9.5px;letter-spacing:.2em;text-transform:uppercase;color:#6f8072}
.fleet-input,.fleet-select{font:inherit;font-size:12px;padding:6px 9px;border:1px solid rgba(140,240,176,.22);background:rgba(0,0,0,.5);color:#dcebdd;min-width:0}
.fleet-input:focus-visible,.fleet-select:focus-visible{outline:1px solid #8cf0b0;outline-offset:1px}
.fleet-actions{display:flex;align-items:center;gap:12px;grid-column:1/-1;margin-top:2px;flex-wrap:wrap}
.fleet-error{font-size:11.5px;color:#ff8a80}
.fleet-ok{font-size:11.5px;color:#8cf0b0}
.fleet-hint{font-size:11px;color:#6f8072;line-height:17px}
.fleet-foot{display:flex;flex-wrap:wrap;gap:18px;padding-top:10px;font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:#5f7062}
@keyframes fleet-blink{0%,100%{opacity:1}50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.fleet-dot.live{animation:none}}
@media (max-width:860px){.fleet-main{grid-template-columns:1fr}.fleet-col+.fleet-col{border-left:0;padding-left:0;margin-left:0;border-top:1px solid rgba(140,240,176,.14)}.fleet-strip{flex-wrap:wrap}.fleet-order{grid-template-columns:14px minmax(0,1fr) auto}.fleet-order-code{display:none}}
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
		 * One roster row: hull index, name, link glyphs, latency. Mirrors the left
		 * rail of a fleet RTS rather than a card grid — the roster is scanned
		 * vertically, not appreciated as a gallery.
		 * @param {{ worker: Record<string, any>, index: number }} props Component props.
		 */
		function ShipRow(props) {
			const worker = props.worker || {}
			const online = worker.online === true
			const latency = typeof worker.latencyMs === 'number' && worker.latencyMs > 0 ? `${worker.latencyMs}ms` : '本机'
			return h(
				'li',
				{ className: 'fleet-ship' },
				h('span', { className: 'fleet-ship-no fleet-mono' }, String(props.index + 1).padStart(2, '0')),
				h(
					'span',
					{ className: 'fleet-ship-name' },
					h('span', { className: online ? '' : 'is-offline' }, String(worker.name || '未命名节点')),
				),
				h(
					'span',
					{ className: `fleet-glyphs${online ? '' : ' is-down'}`, 'aria-hidden': 'true', title: online ? '链路正常' : '失联' },
					h('i'),
					h('i'),
					h('i'),
				),
				h('span', { className: 'fleet-ship-lat fleet-mono' }, latency),
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
				setForm((current) => ({ role: json.data.role, host: json.data.host, port: String(json.data.port), token: current.token }))
			}, [])

			useEffect(() => {
				alive.current = true
				void load()
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
				if (!json.ok) return setError(json.why || '写入失败')
				setError('')
				setNotice('指令已下达 · 配置重载中')
				setTimeout(() => void load(), 400)
			}, [form, load])

			const scan = useCallback(async () => {
				setBusy('scan')
				setNotice('')
				const json = await api('/scan', {})
				setBusy('')
				if (!json.ok) return setError(json.why || '扫描失败')
				setError('')
				setNotice(`扫描完成 · 捕获 ${json.data.discovered.length} 个信号源`)
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
			const view = data.view || { tasks: [], noticeCount: 0 }
			const tasks = view.tasks || []
			const workers = data.workersOnline || []
			const online = workers.filter((worker) => worker.online).length
			const utc = clock.toISOString().slice(11, 19)
			const link = data.listening === true ? (online === workers.length ? 'NOMINAL' : 'DEGRADED') : 'OFFLINE'
			const keyState = data.tokenSource === 'explicit' ? '显式' : data.tokenSource === 'generated' ? '自动' : '未就绪'

			return h(
				'div',
				{ className: 'fleet-deck' },
				h('div', { className: 'fleet-grid', 'aria-hidden': 'true' }),
				h(
					'div',
					{ className: 'fleet-hud' },
					// ---- 顶部状态条 ----
					h(
						'div',
						{ className: 'fleet-strip fleet-mono' },
						h('span', { className: 'fleet-strip-cell' }, 'NODE ', h('b', null, data.deviceName || '—')),
						h('span', { className: 'fleet-strip-cell' }, 'CH ', h('b', null, `${data.host || '—'}:${data.port || '—'}`)),
						h('span', { className: 'fleet-strip-cell' }, 'LINK ', h('b', { className: link === 'NOMINAL' ? 'fleet-online' : link === 'OFFLINE' ? 'fleet-offline' : '' }, link)),
						h('span', { className: 'fleet-strip-cell' }, 'KEYS ', h('b', null, keyState)),
						h('span', { className: 'fleet-strip-cell' }, 'ENGAGED ', h('b', null, `${tasks.length}`)),
						h('span', { className: 'fleet-strip-cell' }, `${utc}Z`),
					),
					// ---- 标题 ----
					h(
						'header',
						{ className: 'fleet-top' },
						h('span', { className: 'fleet-sigil', 'aria-hidden': 'true' }),
						h(
							'div',
							{ className: 'fleet-id' },
							h('p', { className: 'fleet-kicker fleet-mono' }, 'Fleet Command / Deck 01'),
							h('h2', { className: 'fleet-title' }, '舰队指挥舱'),
							h('p', { className: 'fleet-sub' }, '把重任务派给局域网内其它机器上的 DSH。指令下达后本机回到待命，战报抵达时再唤醒。'),
						),
						h(
							'div',
							{ className: 'fleet-top-right' },
							view.noticeCount > 0
								? h('span', { className: 'fleet-badge fleet-mono', role: 'status', 'aria-atomic': 'true' }, `${view.noticeCount} 份战报待接收`)
								: null,
							h('button', { type: 'button', className: 'fleet-btn', onClick: () => void load(), disabled: busy !== '' }, '刷新遥测'),
						),
					),
					// ---- 两栏 ----
					h(
						'div',
						{ className: 'fleet-main' },
						h(
							'section',
							{ className: 'fleet-col fleet-col--rail' },
							h(
								'div',
								{ className: 'fleet-head' },
								h('h3', null, '舰船'),
								h('span', { className: 'fleet-mono' }, `${online}/${workers.length || 1} 在线`),
							),
							workers.length === 0
								? h('p', { className: 'fleet-empty' }, '编队为空。用「扫描编队」捕获局域网信号源。')
								: h('ul', { className: 'fleet-roster' }, workers.map((worker, index) => h(ShipRow, { key: worker.name, worker, index }))),
						),
						h(
							'section',
							{ className: 'fleet-col' },
							h(
								'div',
								{ className: 'fleet-head' },
								h('h3', null, '作战指令'),
								h('span', { className: 'fleet-mono' }, tasks.length === 0 ? 'STANDBY' : `${tasks.length} 条`),
							),
							tasks.length === 0
								? h('p', { className: 'fleet-empty' }, '尚无派发记录。让 Agent 用 fleet_dispatch 下达指令，战报会在这里回报。')
								: h(
										'ul',
										{ className: 'fleet-orders' },
										tasks.map((task) => {
											const meta = ORDER_STATUS[task.status] || ORDER_STATUS.running
											return h(
												'li',
												{ className: 'fleet-order', key: task.sessionId },
												h('span', { className: `fleet-dot ${meta.tone}`, 'aria-hidden': 'true' }),
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
													h('span', { className: `fleet-state ${meta.tone}` }, meta.label),
													h('span', { className: 'fleet-age fleet-mono', title: new Date(task.at).toLocaleString() }, relativeAge(task.ageMs)),
												),
											)
										}),
									),
						),
					),
					// ---- 参数 ----
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
								h('input', { className: 'fleet-input fleet-mono', value: form.port, inputMode: 'numeric', onChange: (event) => setForm({ ...form, port: event.target.value }) }),
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
								h('button', { type: 'button', className: 'fleet-btn fleet-btn-primary', onClick: () => void save(), disabled: busy !== '' }, busy === 'save' ? '下达中' : '下达指令'),
								h('button', { type: 'button', className: 'fleet-btn', onClick: () => void scan(), disabled: busy !== '' }, busy === 'scan' ? '扫描中' : '扫描编队'),
								error ? h('span', { className: 'fleet-error', role: 'alert' }, error) : null,
								notice ? h('span', { className: 'fleet-ok', role: 'status' }, notice) : null,
							),
							h('p', { className: 'fleet-hint fleet-field-wide' }, '写入 profile 的 cordis.patch.yml 并立即重载；识别码只写不读。'),
						),
					),
					h(
						'footer',
						{ className: 'fleet-foot fleet-mono' },
						h('span', null, `LOAD ${data.load ? `${data.load.load1m}/${data.load.cpus}c` : '—'}`),
						h('span', null, `BAND ${data.lan || '—'}`),
						h('span', null, `ORDERS ${tasks.length}`),
						h('span', null, `REPORTS ${view.noticeCount || 0}`),
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
