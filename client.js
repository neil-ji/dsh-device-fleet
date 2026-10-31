/** Miniature fleet deck. Host React and slot API only; no extra client dependencies. */
window.__ModuleLoader__.load({
	id: 'dsh-device-fleet',
	factory: (require) => {
		const React = require('react')
		const h = React.createElement
		const { useCallback, useEffect, useRef, useState } = React
		const API = '/api/device-fleet'
		const ROLES = [['worker+controller', '指挥与执行'], ['worker', '仅执行'], ['controller', '仅指挥']]
		const STATUS = { running: ['等待回报', 'wait'], done: ['已回报', 'ok'], stale: ['长时间未回报', 'warn'] }
		const CSS = `
.fleet-deck{--f-bg:#0e1925;--f-bg-deep:#0a131d;--f-panel:#192a3c;--f-panel-2:#1e3145;--f-panel-3:#243a50;--f-text:#f6eddc;--f-muted:#aebdcc;--f-faint:#8496a7;--f-border:#3a5065;--f-border-strong:#5a7187;--f-accent:#f08c49;--f-accent-soft:#f08c4918;--f-mint:#aee8ce;--f-warn:#ffd08b;--f-error:#ffb3ac;container-type:inline-size;position:relative;isolation:isolate;height:100%;min-height:100%;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#3a5065 transparent;background:radial-gradient(900px 440px at 16% -14%,#294860cc 0,transparent 62%),radial-gradient(760px 420px at 102% -8%,#24384a88 0,transparent 58%),var(--f-bg);color:var(--f-text);font:14px/1.6 var(--dsw-font-sans,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif);color-scheme:dark}
.fleet-deck::-webkit-scrollbar{width:10px;height:10px}.fleet-deck::-webkit-scrollbar-track{background:transparent}.fleet-deck::-webkit-scrollbar-thumb{background:#3a5065;border:3px solid transparent;border-radius:99px;background-clip:content-box}.fleet-deck::-webkit-scrollbar-thumb:hover{background:#59738a;background-clip:content-box}.fleet-deck:before{content:'';position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(#c9dceb14 .8px,transparent .8px);background-size:22px 22px;-webkit-mask-image:linear-gradient(180deg,#000 0,transparent 34%);mask-image:linear-gradient(180deg,#000 0,transparent 34%);z-index:0}
.fleet-deck *{box-sizing:border-box}.fleet-deck h2,.fleet-deck h3,.fleet-deck p{margin:0}.fleet-deck button,.fleet-deck input,.fleet-deck select{font:inherit}.fleet-deck button{cursor:pointer;transition:background .18s,border-color .18s,box-shadow .18s,color .18s,transform .18s}.fleet-deck button:disabled{opacity:.55;cursor:wait}.fleet-deck :is(button,input,select,summary):focus-visible{outline:2px solid var(--f-mint);outline-offset:3px}.fleet-wrap{position:relative;z-index:1;max-width:1440px;margin:auto;padding:28px 32px 30px}.fleet-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}.fleet-kicker{display:flex;align-items:center;gap:8px;font:10.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;color:var(--f-muted)}.fleet-kicker:before{content:'';width:5px;height:5px;border-radius:1px;background:var(--f-accent);box-shadow:0 0 0 3px #f08c4918}.fleet-label{font:10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.13em;color:var(--f-accent);text-transform:uppercase}.fleet-top{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:24px}.fleet-title h2{font-size:31px;line-height:1.2;font-weight:660;letter-spacing:-.02em;margin:9px 0 7px;color:#fff7e8}.fleet-title p{color:var(--f-muted);font-size:13px;letter-spacing:.01em}.fleet-top-side{display:flex;flex-direction:column;align-items:flex-end;gap:12px;flex-shrink:0}.fleet-sync{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;color:var(--f-faint);white-space:nowrap}.fleet-sync:before{content:'';width:6px;height:6px;border-radius:50%;background:var(--f-mint);box-shadow:0 0 0 3px #aee8ce12}.fleet-sync[data-state=busy]:before{background:var(--f-warn)}.fleet-sync[data-state=error]{color:var(--f-error)}.fleet-sync[data-state=error]:before{background:var(--f-error);box-shadow:0 0 0 3px #ffb3ac12}.fleet-actions{display:flex;gap:8px;flex-wrap:wrap}.fleet-btn{min-height:44px;padding:8px 14px;border:1px solid var(--f-border-strong);border-radius:8px;background:#1a2a3b99;color:var(--f-text);white-space:nowrap;box-shadow:inset 0 1px 0 #ffffff08}.fleet-btn:hover{background:#2b4055;border-color:#8da3b5}.fleet-btn-primary{background:var(--f-accent);border-color:var(--f-accent);color:#1b2733;font-weight:680;box-shadow:0 7px 18px #f08c4920}.fleet-btn-primary:hover{background:#ffa466;border-color:#ffa466}.fleet-alert{margin-bottom:15px;padding:11px 15px;border:1px solid #8b6d52;border-radius:9px;background:#302c29;color:var(--f-warn);font-size:13px;overflow-wrap:anywhere}.fleet-alert.error{color:var(--f-error);background:#332931;border-color:#936d71}.fleet-layout{display:grid;grid-template-columns:minmax(0,1fr) 284px;gap:20px;align-items:start}.fleet-hangar,.fleet-action-art,.fleet-note,.fleet-console,.fleet-params,.fleet-settings{border:1px solid var(--f-border);background:linear-gradient(180deg,#1c2e42f2,#172738f2);box-shadow:0 18px 46px #0000002e,inset 0 1px 0 #ffffff09}.fleet-hangar{border-radius:17px;overflow:hidden;min-width:0}.fleet-hangar-head{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:16px 20px;border-bottom:1px solid #30465b}.fleet-hangar-head h3{font-size:17px;font-weight:650;letter-spacing:.01em}.fleet-online{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--f-muted);white-space:nowrap}.fleet-online:before{content:'';width:6px;height:6px;border-radius:50%;background:var(--f-mint);box-shadow:0 0 0 3px #aee8ce10}.fleet-formation{display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:14px;padding:18px;background:radial-gradient(ellipse at 50% -10%,#4a6b8852 0,transparent 66%),radial-gradient(#a9c8de1c .75px,transparent .75px),linear-gradient(180deg,#17293b99,#13223199);background-size:auto,19px 19px,auto}.fleet-vessel{position:relative;display:flex;flex-direction:column;min-width:0;text-align:left;padding:13px 14px 14px;border:1px solid #3a5065;border-radius:13px;background:linear-gradient(180deg,#20364bd9,#192b3dd9);color:var(--f-text);overflow:hidden;box-shadow:inset 0 1px 0 #ffffff0a}.fleet-vessel:before{content:'';position:absolute;left:14%;right:14%;top:50px;height:112px;background:radial-gradient(ellipse at center,#f08c4921 0,transparent 68%);pointer-events:none}.fleet-vessel:hover{background:linear-gradient(180deg,#274158,#1d3246);border-color:#7c94a8;transform:translateY(-2px)}.fleet-vessel[aria-pressed=true]{border-color:var(--f-accent);background:linear-gradient(180deg,#2a4054,#213548);box-shadow:inset 0 0 0 1px var(--f-accent),0 14px 28px #0000002e}.fleet-vessel[aria-pressed=true] .fleet-berth-no{color:var(--f-accent)}.fleet-vessel.is-offline .fleet-art{filter:grayscale(.9) opacity(.46)}.fleet-vessel.is-offline:before{opacity:.18}.fleet-berth{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11px;color:var(--f-faint)}.fleet-berth-no{display:inline-flex;align-items:baseline;gap:5px;color:#c9d6e2;font-size:11px}.fleet-berth-no b{font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;font-weight:500}.fleet-role{font-size:11px;color:var(--f-muted);letter-spacing:.02em;text-align:right}.fleet-role.is-local{color:var(--f-accent)}.fleet-vessel-body{position:relative;z-index:1;display:flex;flex-direction:column;flex:1;min-width:0}.fleet-vessel .fleet-art{display:block;width:100%;height:150px;object-fit:contain;margin:1px 0 2px;filter:drop-shadow(0 15px 14px #00000066);transition:transform .2s,filter .2s}.fleet-vessel:hover .fleet-art{transform:translateY(-4px)}.fleet-vessel-copy{display:flex;flex-direction:column;gap:5px;min-width:0}.fleet-vessel-copy strong{font-size:16.5px;line-height:1.35;font-weight:650;letter-spacing:.005em;overflow-wrap:anywhere}.fleet-vessel-status{display:flex;justify-content:space-between;align-items:center;gap:10px;min-width:0;font-size:11.5px;color:var(--f-faint)}.fleet-latency{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;white-space:nowrap;color:var(--f-faint)}.fleet-vessel-work{font-size:11.5px;color:var(--f-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fleet-badge{display:inline-flex;align-items:center;gap:5px;color:var(--f-mint);font-size:11.5px;line-height:1.5;white-space:nowrap}.fleet-badge:before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor;flex-shrink:0;box-shadow:0 0 0 3px #aee8ce10}.fleet-badge.wait{color:#c9d8e7}.fleet-badge.warn{color:var(--f-warn)}.fleet-badge.warn:before{box-shadow:0 0 0 3px #ffd08b10}.fleet-badge.off{color:#c2c8cf}.fleet-badge.off:before{box-shadow:none}.fleet-hangar-foot{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:11px 20px;border-top:1px solid #30465b;font-size:11.5px;color:var(--f-faint)}.fleet-hangar-foot strong{font-weight:550;color:var(--f-muted)}.fleet-berth-empty{display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:250px;padding:18px;text-align:center;border:1px dashed #486278;border-radius:13px;background:#14233488;color:var(--f-muted)}.fleet-berth-empty .fleet-art{width:190px;max-width:100%;height:132px;object-fit:contain;filter:drop-shadow(0 12px 12px #00000055);opacity:.9}.fleet-berth-empty h3{font-size:15px;font-weight:620;color:var(--f-text);margin:3px 0 4px}.fleet-berth-empty p{font-size:11.5px;line-height:1.75;max-width:240px}.fleet-berth-empty .fleet-btn{margin-top:12px;min-height:42px;padding:7px 14px;font-size:12px}.fleet-side{display:flex;flex-direction:column;gap:16px;min-width:0}.fleet-action-art{position:relative;min-height:190px;padding:18px;border-radius:15px;overflow:hidden;display:flex;flex-direction:column;align-items:flex-start}.fleet-action-art:after{content:'';position:absolute;right:-12px;bottom:-14px;width:160px;height:130px;background:radial-gradient(ellipse at 60% 60%,#f08c491b 0,transparent 68%);pointer-events:none}.fleet-action-art .fleet-art{position:absolute;right:-9px;bottom:-1px;width:130px;height:124px;object-fit:contain;filter:drop-shadow(0 13px 13px #00000055);pointer-events:none;z-index:1}.fleet-action-copy{position:relative;z-index:2;width:100%;padding-right:104px}.fleet-action-art h3{font-size:17.5px;line-height:1.35;font-weight:640;margin:7px 0 4px;letter-spacing:-.01em}.fleet-action-art p{font-size:11.5px;line-height:1.65;color:var(--f-muted);max-width:100%}.fleet-action-art .fleet-btn{position:relative;z-index:2;margin-top:auto;min-height:42px;padding:7px 13px;font-size:12.5px}.fleet-note{position:relative;min-height:190px;padding:18px;border-radius:15px;overflow:hidden}.fleet-note .fleet-label{color:var(--f-muted)}.fleet-note h3{font-size:17px;font-weight:640;margin:12px 0 6px;letter-spacing:-.01em}.fleet-note p{font-size:11.5px;line-height:1.75;color:var(--f-muted);max-width:200px}.fleet-note-symbol{position:absolute;right:17px;top:11px;font:32px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--f-accent);opacity:.72;letter-spacing:-.12em}.fleet-settings{border-radius:14px;margin-bottom:20px;overflow:hidden}.fleet-settings-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;padding:18px 18px 0}.fleet-settings-head h3{font-size:18px;font-weight:650;margin:7px 0 3px}.fleet-settings-head p{font-size:11.5px;line-height:1.7;color:var(--f-faint)}.fleet-settings-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end}.fleet-settings-dirty{font-size:11px;color:var(--f-warn);white-space:nowrap}.fleet-settings .fleet-form{padding-top:14px}.fleet-dirty-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--f-accent);margin-left:6px;vertical-align:middle;box-shadow:0 0 0 3px #f08c4918}.fleet-task-section{margin-top:30px}.fleet-section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:13px}.fleet-section-head h3{font-size:20px;line-height:1.3;font-weight:650;letter-spacing:-.015em}.fleet-section-head span{font-size:11.5px;color:var(--f-faint)}.fleet-console{overflow:hidden;border-radius:16px}.fleet-console-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid #30465b;background:#17283a99}.fleet-filters{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.fleet-filter{display:inline-flex;align-items:baseline;gap:7px;min-height:42px;padding:7px 12px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--f-muted);font-size:12.5px}.fleet-filter:hover{background:#22364a;color:var(--f-text)}.fleet-filter[aria-pressed=true]{background:#263c51;border-color:#4a647b;color:#fff7e9;box-shadow:inset 0 1px 0 #ffffff0a}.fleet-filter small{font:10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--f-faint)}.fleet-filter[aria-pressed=true] small{color:var(--f-accent)}.fleet-scope{display:flex;align-items:center;gap:7px;min-width:0;padding-left:4px;font-size:11.5px;color:var(--f-faint)}.fleet-scope-name{max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--f-text)}.fleet-scope button{min-height:32px;padding:4px 9px;border:1px solid #3e566c;border-radius:6px;background:transparent;color:var(--f-muted);font-size:11px}.fleet-scope button:hover{background:#22364a;color:var(--f-text)}.fleet-missions{display:grid;grid-template-columns:minmax(0,1fr) 302px;align-items:stretch}.fleet-orders{min-width:0;display:flex;flex-direction:column}.fleet-orders-end{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:auto;padding:11px 18px;border-top:1px solid #2d4257;background:#16263766;color:var(--f-faint);font-size:10.5px}.fleet-order{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:16px;width:100%;min-width:0;padding:15px 18px;border:0;border-bottom:1px solid #2d4257;background:transparent;color:var(--f-text);text-align:left}.fleet-order:last-child{border-bottom:0}.fleet-order:hover{background:#20344a}.fleet-order[aria-pressed=true]{background:#22384d;box-shadow:inset 2px 0 var(--f-accent)}.fleet-order-main{display:flex;flex-direction:column;gap:5px;min-width:0}.fleet-order-title{display:block;font-size:14px;line-height:1.5;font-weight:600;letter-spacing:.005em;overflow-wrap:anywhere}.fleet-order-sub{display:flex;align-items:center;gap:7px;min-width:0;font-size:11px;color:var(--f-faint);line-height:1.5}.fleet-order-device{color:var(--f-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:45%}.fleet-order-code{color:#8799aa;font-size:10.5px;letter-spacing:.02em}.fleet-order-code:before{content:'#';opacity:.6}.fleet-order-side{display:flex;flex-direction:column;align-items:flex-end;gap:5px;min-width:96px}.fleet-order-time{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;color:var(--f-faint);white-space:nowrap}.fleet-detail{display:flex;flex-direction:column;min-width:0;padding:18px;border-left:1px solid #30465b;background:linear-gradient(180deg,#1c2e42 0,#182839 100%)}.fleet-detail-bar{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}.fleet-detail-bar .fleet-label{color:var(--f-faint)}.fleet-detail h3{font-size:16px;line-height:1.5;font-weight:640;letter-spacing:-.005em;overflow-wrap:anywhere}.fleet-session{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 8px;align-items:center;margin:12px 0;padding:8px 9px;border:1px solid #334b60;border-radius:8px;background:#111e2b}.fleet-session-label{grid-column:1/-1;font-size:10px;color:var(--f-faint);letter-spacing:.08em}.fleet-session-id{min-width:0;overflow-wrap:anywhere;color:#c5d3df;font-size:10.5px;line-height:1.55}.fleet-session button{min-height:30px;padding:3px 8px;border:1px solid #435b70;border-radius:5px;background:#1c3042;color:var(--f-muted);font-size:10.5px;white-space:nowrap}.fleet-session button:hover{background:#2a4157;color:var(--f-text)}.fleet-detail dl{display:grid;grid-template-columns:64px minmax(0,1fr);gap:6px 10px;margin:0 0 12px;font-size:11.5px}.fleet-detail dt{color:var(--f-faint)}.fleet-detail dd{margin:0;color:var(--f-text);overflow-wrap:anywhere}.fleet-detail-note{margin-top:auto!important;padding-top:12px;border-top:1px solid #30465b;font-size:11.5px;line-height:1.8;color:var(--f-muted)}.fleet-detail-foot{display:block;margin-top:5px;font-size:10.5px;color:var(--f-faint)}.fleet-empty-task{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:355px;padding:26px;text-align:center;color:var(--f-muted)}.fleet-empty-task .fleet-art{width:270px;max-width:100%;height:178px;object-fit:contain;filter:drop-shadow(0 14px 16px #00000055)}.fleet-empty-task h3{font-size:17px;color:var(--f-text);margin:1px 0 5px;font-weight:640}.fleet-empty-task p{font-size:12px;line-height:1.8;max-width:350px}.fleet-empty-task .fleet-btn{margin-top:13px}.fleet-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:520px;padding:44px 24px;text-align:center;border:1px dashed #3d566c;border-radius:17px;background:linear-gradient(180deg,#182a3bcc,#132131cc);color:var(--f-muted)}.fleet-loading .fleet-art{display:block;width:300px;max-width:100%;height:200px;object-fit:contain;filter:drop-shadow(0 16px 18px #00000055)}.fleet-loading h3{font-size:19px;font-weight:640;color:var(--f-text);margin:2px 0 5px}.fleet-loading p{font-size:12px;max-width:360px}.fleet-loading .fleet-btn{margin-top:16px}.fleet-params{border-radius:12px;margin-top:16px;overflow:hidden}.fleet-params>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 17px;min-height:48px;cursor:pointer;font-size:12.5px;color:var(--f-muted);list-style-position:inside}.fleet-params>summary:hover{background:#20344a;color:var(--f-text)}.fleet-params>summary::-webkit-details-marker{color:var(--f-faint)}.fleet-params[open]>summary{border-bottom:1px solid #30465b;color:var(--f-text)}.fleet-params>summary small{font:10.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--f-faint)}.fleet-report-list{padding:4px 17px 10px}.fleet-report-item{display:flex;justify-content:space-between;align-items:baseline;gap:18px;padding:10px 0;border-bottom:1px solid #2b4054;font-size:12px}.fleet-report-item:last-child{border-bottom:0}.fleet-report-item strong{font-weight:550;color:var(--f-text);overflow-wrap:anywhere}.fleet-report-item small{font-size:10.5px;color:var(--f-faint);white-space:nowrap}.fleet-form{padding:18px 17px 17px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}.fleet-field{display:flex;flex-direction:column;gap:6px;color:var(--f-muted);font-size:12px;min-width:0}.fleet-input{width:100%;min-height:42px;padding:9px 11px;border:1px solid #5b7288;border-radius:7px;background:#0e1a26;color:var(--f-text);font-size:13px}.fleet-input::placeholder{color:#7e91a3}.fleet-input:focus-visible{outline-offset:2px}.fleet-form .fleet-actions,.fleet-form-note{grid-column:1/-1}.fleet-form-note{font-size:11px;line-height:1.7;color:var(--f-faint)}.fleet-footer{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:22px;padding-top:14px;border-top:1px solid #2e4357;font-size:10.5px;color:var(--f-faint)}.fleet-footer .fleet-mono{letter-spacing:.08em;color:#718698}.fleet-toast{position:fixed;left:50%;bottom:22px;z-index:60;display:flex;align-items:flex-start;gap:10px;width:max-content;max-width:min(560px,calc(100vw - 28px));padding:11px 12px 11px 15px;border:1px solid #557c70;border-radius:10px;background:#214139f2;color:#c8f4df;box-shadow:0 18px 46px #00000070;backdrop-filter:blur(8px);transform:translateX(-50%);animation:fleet-toast-in .2s ease-out}.fleet-toast.is-error{border-color:#936d71;background:#332931f2;color:var(--f-error)}.fleet-toast-copy{min-width:0}.fleet-toast p{font-size:12px;line-height:1.65;overflow-wrap:anywhere}.fleet-toast .fleet-discovered{margin-top:7px}.fleet-toast-close{flex:0 0 auto;display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:5px;background:transparent;color:currentColor;font-size:16px;line-height:1;opacity:.75}.fleet-toast-close:hover{background:#ffffff12;opacity:1}.fleet-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.fleet-discovered{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}.fleet-discovered span{padding:4px 8px;border:1px solid #4a647b;border-radius:5px;background:#1b2e40;color:var(--f-text);font-size:11px}.fleet-clip{overflow-wrap:anywhere}
@container(max-width:1080px){.fleet-layout{grid-template-columns:minmax(0,1fr) 254px}.fleet-missions{grid-template-columns:minmax(0,1fr) 278px}.fleet-formation{grid-template-columns:repeat(auto-fit,minmax(188px,1fr));padding:16px;gap:12px}.fleet-vessel{padding:12px}.fleet-vessel .fleet-art{height:137px}.fleet-wrap{padding:24px}.fleet-action-art{padding:16px}.fleet-action-art .fleet-art{width:126px;opacity:.9}}
@container(max-width:840px){.fleet-layout{grid-template-columns:1fr}.fleet-side{display:grid;grid-template-columns:1fr 1fr;gap:14px}.fleet-action-art,.fleet-note{min-height:158px}.fleet-action-copy{padding-right:152px}.fleet-action-art .fleet-art{width:126px;opacity:1}.fleet-missions{grid-template-columns:minmax(0,1fr) 265px}.fleet-wrap{padding:22px}.fleet-top{align-items:flex-start}.fleet-title h2{font-size:28px}.fleet-formation{grid-template-columns:repeat(auto-fit,minmax(178px,1fr))}}
@container(max-width:740px){.fleet-side{grid-template-columns:1fr}}
@container(max-width:640px){.fleet-side{grid-template-columns:1fr}.fleet-top{flex-wrap:wrap;gap:15px}.fleet-top-side{width:100%;flex-direction:row;align-items:center;justify-content:space-between}.fleet-actions{justify-content:flex-end}.fleet-missions{grid-template-columns:1fr}.fleet-detail{border-left:0;border-top:1px solid #30465b}.fleet-formation{grid-template-columns:1fr}.fleet-vessel{flex-direction:row;align-items:center;gap:13px;padding:12px 14px}.fleet-berth{position:absolute;top:12px;left:14px;right:14px;z-index:2}.fleet-vessel-body{display:grid;grid-template-columns:116px minmax(0,1fr);align-items:center;gap:13px;width:100%;padding-top:22px}.fleet-vessel .fleet-art{height:104px;margin:0}.fleet-vessel-copy{gap:6px}.fleet-vessel-copy strong{font-size:15px}.fleet-vessel-work{white-space:normal;line-height:1.6}.fleet-berth-empty{min-height:220px}.fleet-action-art{min-height:164px}.fleet-action-art .fleet-art{width:126px;height:120px}.fleet-action-copy{padding-right:152px;max-width:none}.fleet-action-art p{max-width:220px}.fleet-section-head{align-items:flex-start;flex-direction:column;gap:4px}.fleet-section-head h3{font-size:19px}.fleet-empty-task{min-height:320px}.fleet-empty-task .fleet-art{height:155px}.fleet-loading{min-height:440px}}
@container(max-width:480px){.fleet-wrap{padding:18px 15px 22px}.fleet-title h2{font-size:26px}.fleet-top-side{flex-wrap:wrap;gap:10px}.fleet-sync{font-size:11px}.fleet-btn{padding:8px 11px;font-size:12.5px}.fleet-formation{padding:12px;gap:10px}.fleet-vessel-body{grid-template-columns:96px minmax(0,1fr);gap:10px}.fleet-vessel .fleet-art{height:88px}.fleet-berth{left:12px;right:12px}.fleet-hangar-head{padding:14px 15px}.fleet-settings-head{padding:15px 15px 0}.fleet-settings-actions{gap:8px}.fleet-settings .fleet-form{padding-top:12px}.fleet-hangar-foot{padding:10px 15px}.fleet-action-art{min-height:162px;padding:15px}.fleet-action-art .fleet-art{width:118px;height:110px;right:-7px}.fleet-action-art h3{font-size:17px}.fleet-note{min-height:150px;padding:15px}.fleet-console-bar{align-items:flex-start;padding:9px}.fleet-filter{min-height:44px;padding:6px 9px;font-size:12px}.fleet-scope{width:100%;padding:3px 4px 0}.fleet-scope-name{max-width:160px}.fleet-order{grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:13px 14px}.fleet-order-side{min-width:84px}.fleet-order-sub{gap:6px}.fleet-order-device{max-width:42%}.fleet-detail{padding:16px}.fleet-action-copy{padding-right:142px}.fleet-form{grid-template-columns:1fr;padding:15px}.fleet-report-item{display:block}.fleet-report-item small{display:block;margin-top:4px;white-space:normal}.fleet-footer{display:block}.fleet-footer .fleet-mono{display:block;margin-top:7px}.fleet-toast{bottom:12px;max-width:calc(100vw - 24px);padding:10px 10px 10px 13px}.fleet-empty-task{min-height:295px;padding:20px 14px}.fleet-empty-task .fleet-art{width:235px;height:145px}}
@keyframes fleet-toast-in{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}@keyframes fleet-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.fleet-hangar,.fleet-action-art,.fleet-note,.fleet-task-section{animation:fleet-rise .32s ease-out both}.fleet-action-art:nth-child(2){animation-delay:.04s}
@media(prefers-reduced-motion:reduce){.fleet-deck *{transition:none!important;animation:none!important}.fleet-vessel:hover .fleet-art{transform:none}}
`
		function panelToken() { return typeof window.__DSH_FLEET_TOKEN__ === 'string' ? window.__DSH_FLEET_TOKEN__ : '' }
		async function api(path, body) {
			try {
				const token = panelToken()
				const response = await fetch(API + path, {
					method: body === undefined ? 'GET' : 'POST',
					credentials: 'same-origin',
					signal: AbortSignal.timeout(12000),
					headers: {
						...(token ? { 'x-fleet-token': token } : {}),
						...(body === undefined ? {} : { 'content-type': 'application/json' }),
					},
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				})
				const json = await response.json()
				return response.ok ? json : { ok: false, why: json.why || '请求未完成，请重试' }
			} catch { return { ok: false, why: '暂时无法连接舰队，请稍后重试' } }
		}
		function art(name, className = '') {
			const token = panelToken()
			return h('img', {
				className: `fleet-art ${className}`,
				src: `${API}/assets/${name}.png${token ? `?t=${encodeURIComponent(token)}` : ''}`,
				alt: '',
				'aria-hidden': true,
				decoding: 'async',
				draggable: false,
				width: 768,
				height: 512,
			})
		}
		function age(ms) {
			if (!Number.isFinite(ms) || ms < 0) return '时间未知'
			if (ms < 60000) return '刚刚'
			if (ms < 3600000) return `${Math.floor(ms / 60000)} 分钟前`
			if (ms < 86400000) return `${Math.floor(ms / 3600000)} 小时前`
			return `${Math.floor(ms / 86400000)} 天前`
		}
		function two(value) { return String(value).padStart(2, '0') }
		function time(at) {
			if (!Number.isFinite(at) || at <= 0) return '未记录'
			const date = new Date(at)
			return `${date.getFullYear()}/${two(date.getMonth() + 1)}/${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
		}
		function clock(at) {
			const date = new Date(at)
			return `${two(date.getHours())}:${two(date.getMinutes())}`
		}
		function taskKey(task) { return `${task.device}\u0000${task.sessionId}` }
		function badge(label, tone = '') { return h('span', { className: `fleet-badge ${tone}` }, label) }
		function button(label, onClick, options = {}) {
			return h('button', { type: 'button', className: 'fleet-btn', onClick, ...options }, label)
		}
		function Deck() {
			const [state, setState] = useState(null)
			const [loadError, setLoadError] = useState('')
			const [actionError, setActionError] = useState('')
			const [notice, setNotice] = useState('')
			const [busy, setBusy] = useState('')
			const [refreshing, setRefreshing] = useState(false)
			const [updatedAt, setUpdatedAt] = useState(0)
			const [scope, setScope] = useState(null)
			const [filter, setFilter] = useState('all')
			const [selected, setSelected] = useState(null)
			const [scanResults, setScanResults] = useState(null)
			const [form, setForm] = useState({ role: 'worker+controller', host: '', port: '', token: '' })
			const [dirty, setDirty] = useState(false)
			const [copied, setCopied] = useState('')
			const [settingsOpen, setSettingsOpen] = useState(false)
			const dirtyRef = useRef(false)
			const alive = useRef(true)
			const pending = useRef(null)
			const action = useRef(false)
			const settings = useRef(null)
			const settingsButton = useRef(null)
			const tasksRef = useRef(null)
			const copyTimer = useRef(null)
			const load = useCallback(() => {
				if (pending.current) return pending.current
				setRefreshing(true)
				const request = (async () => {
					const json = await api('/state')
					if (!alive.current) return
					if (!json.ok || !json.data) { setLoadError(json.why || '读取状态失败'); return }
					setLoadError(''); setState(json.data); setUpdatedAt(Date.now())
					if (!dirtyRef.current) setForm({ role: json.data.role, host: json.data.host, port: String(json.data.port), token: '' })
				})().finally(() => { pending.current = null; if (alive.current) setRefreshing(false) })
				pending.current = request
				return request
			}, [])
			useEffect(() => {
				if (!settingsOpen) return
				settings.current?.scrollIntoView({ block: 'nearest' })
				settings.current?.querySelector('input')?.focus({ preventScroll: true })
			}, [settingsOpen])
			useEffect(() => {
				if (!notice) return
				const timer = setTimeout(() => { if (alive.current) { setNotice(''); setScanResults(null) } }, 6000)
				return () => clearTimeout(timer)
			}, [notice])
			useEffect(() => {
				alive.current = true; void load()
				const beat = setInterval(() => { if (document.visibilityState !== 'hidden' && !action.current) void load() }, 20000)
				return () => { alive.current = false; clearInterval(beat); if (copyTimer.current) clearTimeout(copyTimer.current) }
			}, [load])
			const change = (key, value) => { dirtyRef.current = true; setDirty(true); setForm(current => ({ ...current, [key]: value })) }
			const scan = async () => {
				if (action.current) return
				action.current = true; setBusy('scan'); setActionError(''); setNotice(''); setScanResults(null)
				const json = await api('/scan', {})
				if (!alive.current) { action.current = false; return }
				if (json.ok) {
					const found = json.data?.discovered || []
					setScanResults(found)
					setNotice(found.length ? `发现 ${found.length} 台设备。已配对设备会显示在编队中。` : '暂未发现新设备。请确认另一台机器已打开 DSH 舰队插件，并连接同一局域网。')
					await load()
				} else setActionError(json.why || '扫描失败，请重试')
				action.current = false; if (alive.current) setBusy('')
			}
			const save = async event => {
				event.preventDefault()
				if (action.current) return
				if (!form.host.trim() || !Number.isInteger(Number(form.port)) || Number(form.port) < 1 || Number(form.port) > 65535) {
					setActionError('请填写监听地址与 1–65535 之间的端口')
					return
				}
				action.current = true; setBusy('save'); setActionError(''); setNotice(''); setScanResults(null)
				// Drain an earlier snapshot before writing so it cannot roll back the saved form.
				if (pending.current) await pending.current
				const patch = { role: form.role, host: form.host.trim(), port: Number(form.port) }
				if (form.token) patch.token = form.token
				const json = await api('/config', patch)
				if (!alive.current) { action.current = false; return }
				if (json.ok) {
					dirtyRef.current = false; setDirty(false)
					setForm(current => ({ ...current, token: '' }))
					setNotice('设置已保存，正在更新连接状态。'); await load()
				} else setActionError(json.why || '保存失败，修改内容已保留')
				action.current = false; if (alive.current) setBusy('')
			}
			const copySession = async id => {
				try {
					await navigator.clipboard.writeText(id)
					if (!alive.current) return
					setCopied(id)
					if (copyTimer.current) clearTimeout(copyTimer.current)
					copyTimer.current = setTimeout(() => { if (alive.current) setCopied('') }, 1800)
				} catch {
					if (alive.current) setActionError('无法自动复制，请在任务详情中选中会话编号后复制。')
				}
			}
			const closeSettings = () => {
				setSettingsOpen(false)
				window.requestAnimationFrame(() => settingsButton.current?.focus())
			}
			const toggleSettings = () => {
				if (!state) return
				if (settingsOpen) closeSettings()
				else setSettingsOpen(true)
			}
			const data = state || {}
			const tasks = data.view?.tasks || []
			const workers = data.workersOnline || []
			const online = workers.filter(w => w.online === true).length
			const notices = data.view?.noticeCount || 0
			const recent = data.view?.recentNotices || []
			const scoped = tasks.filter(t => scope === null || t.device === scope)
			const filtered = scoped.filter(t => filter === 'all' || (filter === 'done' ? t.status === 'done' : t.status !== 'done'))
			const current = filtered.find(t => taskKey(t) === selected) || filtered[0]
			const role = ROLES.find(r => r[0] === data.role)?.[1] || '等待连接'
			const titleOf = t => t.title || `未命名会话 · ${t.shortId || '无编号'}`
			const statusOf = t => STATUS[t.status] || ['状态待确认', 'wait']
			const counts = {
				all: scoped.length,
				waiting: scoped.filter(t => t.status !== 'done').length,
				done: scoped.filter(t => t.status === 'done').length,
			}
			const showReports = () => {
				setFilter('done'); setScope(null); setSelected(null)
				tasksRef.current?.scrollIntoView({ block: 'start' })
				tasksRef.current?.focus({ preventScroll: true })
			}
			const field = (label, key, options = {}) => h('label', { className: 'fleet-field' }, label, h('input', { className: 'fleet-input', value: form[key], onChange: e => change(key, e.target.value), disabled: busy === 'save' || !state, ...options }))
			const syncLabel = loadError ? (state ? '读取失败，保留旧数据' : '连接失败') : !state ? '正在建立连接…' : refreshing ? '正在同步状态…' : updatedAt ? `已同步 ${clock(updatedAt)}` : '等待同步'
			const hasCompany = workers.length >= 2
			const toast = actionError ? { tone: 'error', message: actionError } : notice ? { tone: 'ok', message: notice } : null
			return h('div', { className: 'fleet-deck' }, h('div', { className: 'fleet-wrap' },
				h('header', { className: 'fleet-top' },
					h('div', { className: 'fleet-title' },
						h('div', { className: 'fleet-kicker' }, 'FLEET / HOME DOCK'),
						h('h2', null, '设备舰队'),
						h('p', null, '把重任务交给对的设备，回报会回到这里。'),
					),
					h('div', { className: 'fleet-top-side' },
						h('div', { className: 'fleet-sync', 'data-state': loadError ? 'error' : refreshing ? 'busy' : 'ok' }, syncLabel),
						h('div', { className: 'fleet-actions' },
							button(refreshing ? '更新中…' : '刷新状态', () => void load(), { disabled: refreshing || busy !== '' }),
							h('button', {
								ref: settingsButton, type: 'button', className: 'fleet-btn', onClick: toggleSettings, disabled: !state,
								'aria-expanded': settingsOpen,
								'aria-controls': settingsOpen ? 'fleet-settings' : undefined,
								'aria-label': dirty ? '舰队设置，有未保存的修改' : '舰队设置',
							}, '舰队设置', dirty ? h('span', { className: 'fleet-dirty-dot', 'aria-hidden': true }) : null),
						),
					),
				),
				loadError ? h('div', { className: 'fleet-alert error', role: 'alert' }, loadError, state ? ' · 当前保留上次成功获取的数据。' : '') : null,
				!state ? h('div', { className: 'fleet-loading', role: 'status', 'aria-busy': refreshing },
					art('standby-diorama'),
					h('h3', null, loadError ? '暂时没有接上舰队' : '正在连接你的舰队'),
					h('p', null, loadError ? '检查本机插件是否已启动，或稍后重试。' : '读取设备编队与任务记录，请稍候。'),
					loadError ? button('重新连接', () => void load(), { disabled: refreshing, className: 'fleet-btn fleet-btn-primary' }) : null,
				) : h(React.Fragment, null,
					settingsOpen ? h('section', { className: 'fleet-settings', id: 'fleet-settings', ref: settings, 'aria-label': '舰队设置' },
						h('div', { className: 'fleet-settings-head' },
							h('div', null,
								h('div', { className: 'fleet-label' }, 'FLEET CONFIG'),
								h('h3', null, '舰队设置'),
								h('p', null, '连接参数与角色。保存后立即应用。'),
							),
							h('div', { className: 'fleet-settings-actions' },
								dirty ? h('span', { className: 'fleet-settings-dirty' }, '有未保存的修改') : null,
								h('button', { type: 'button', className: 'fleet-btn', onClick: closeSettings }, '收起'),
							),
						),
						h('form', { className: 'fleet-form', onSubmit: save },
							h('label', { className: 'fleet-field' }, '本机角色',
								h('select', { className: 'fleet-input', value: form.role, disabled: busy === 'save' || !state, onChange: e => change('role', e.target.value) },
									ROLES.map(([value, label]) => h('option', { key: value, value }, label)),
								),
							),
							field('监听地址', 'host', { required: true, spellCheck: false, autoComplete: 'off' }),
							field('监听端口', 'port', { required: true, type: 'number', min: 1, max: 65535, step: 1, inputMode: 'numeric' }),
							field('连接密钥', 'token', { type: 'password', autoComplete: 'new-password', placeholder: '留空保留原密钥' }),
							h('p', { className: 'fleet-form-note' }, '通常无需修改。密钥只写不读；保存后连接设置会立即应用。'),
							h('div', { className: 'fleet-actions' },
								h('button', { type: 'submit', className: 'fleet-btn fleet-btn-primary', disabled: busy !== '' || !state || !dirty }, busy === 'save' ? '保存中…' : '保存设置'),
								button('撤销修改', () => {
									dirtyRef.current = false; setDirty(false)
									setForm({ role: data.role, host: data.host, port: String(data.port), token: '' })
									setActionError('')
								}, { disabled: !dirty || busy !== '' || !state }),
							),
						),
					) : null,
					h('div', { className: 'fleet-layout' },
						h('section', { className: 'fleet-hangar', 'aria-label': '设备编队' },
							h('div', { className: 'fleet-hangar-head' },
								h('h3', null, '我的编队'),
								h('span', { className: 'fleet-online' }, `${online} / ${workers.length} 在线`),
							),
							h('div', { className: 'fleet-formation' }, workers.map((w, i) => {
								const local = w.name === data.deviceName
								const count = tasks.filter(t => t.device === w.name && t.status !== 'done').length
								const connection = local ? '本机连接' : w.online && Number.isFinite(w.latencyMs) ? `${w.latencyMs} ms` : '连接未就绪'
								const work = count ? `${count} 项任务等待回报` : '没有待回报任务'
								return h('button', {
									key: w.name,
									type: 'button',
									className: `fleet-vessel ${w.online === false ? 'is-offline' : ''}`,
									'aria-pressed': scope === w.name,
									'aria-label': `${w.name}，${local ? '本机，' : ''}${w.online ? '在线' : '离线'}，${work}，点击筛选任务`,
									onClick: () => { setScope(scope === w.name ? null : w.name); setSelected(null) },
								},
									h('span', { className: 'fleet-berth' },
										h('span', { className: 'fleet-berth-no' }, '泊位 ', h('b', null, String(i + 1).padStart(2, '0'))),
										h('span', { className: `fleet-role ${local ? 'is-local' : ''}` }, local ? `本机 · ${role}` : '执行节点'),
									),
									h('span', { className: 'fleet-vessel-body' },
										art(local && data.role !== 'worker' ? 'command-ship' : 'compute-ship'),
										h('span', { className: 'fleet-vessel-copy' },
											h('strong', { title: w.name || '未命名设备' }, w.name || '未命名设备'),
											h('span', { className: 'fleet-vessel-status' },
												badge(w.online ? '在线' : '离线', w.online ? 'ok' : 'off'),
												h('span', { className: 'fleet-latency' }, connection),
											),
											h('span', { className: 'fleet-vessel-work' }, work),
										),
									),
								)
							}), !hasCompany ? h('div', { className: 'fleet-berth-empty' },
								art('docking-pad'),
								h('h3', null, '还有一个空泊位'),
								h('p', null, '让同一局域网的另一台设备加入编队。'),
								button(busy === 'scan' ? '扫描中…' : '扫描加入', scan, { disabled: busy !== '', className: 'fleet-btn fleet-btn-primary' }),
							) : null),
							h('div', { className: 'fleet-hangar-foot' },
								h('span', { className: 'fleet-clip' }, h('strong', null, data.deviceName || '本机'), ` · ${role}`),
								h('span', null, data.role === 'controller' ? '仅指挥模式' : data.listening ? '可接受新设备' : '监听未开启'),
							),
						),
						h('aside', { className: 'fleet-side', 'aria-label': '舰队操作' },
							h('div', { className: 'fleet-action-art' },
								art('report-capsule'),
								h('div', { className: 'fleet-action-copy' },
									h('div', { className: 'fleet-label' }, '回报接收'),
									h('h3', null, notices ? `${notices} 份回报已抵达` : '回报接收站'),
									h('p', null, notices ? '等待 Agent 接收。' : '完成通知会在这里汇集。'),
									button('查看已回报', showReports),
								),
							),
							hasCompany
								? h('div', { className: 'fleet-action-art' },
									art('discovery-beacon'),
									h('div', { className: 'fleet-action-copy' },
										h('div', { className: 'fleet-label' }, '编队扩展'),
										h('h3', null, '寻找新伙伴'),
										h('p', null, '发现局域网新设备。'),
										button(busy === 'scan' ? '正在扫描…' : '扫描设备', scan, { disabled: busy !== '', className: 'fleet-btn fleet-btn-primary' }),
									),
								)
								: h('div', { className: 'fleet-note' },
									h('span', { className: 'fleet-note-symbol', 'aria-hidden': true }, '≠'),
									h('div', { className: 'fleet-label' }, '任务边界'),
									h('h3', null, '回报不是验收'),
									h('p', null, '收到回报只说明任务结束。结果与验收，请回到原会话确认。'),
								),
						),
					),
					h('section', { className: 'fleet-task-section', ref: tasksRef, tabIndex: -1, 'aria-label': '任务航程' },
						h('div', { className: 'fleet-section-head' },
							h('h3', null, '任务航程'),
							h('span', null, '在对话里派发，在这里看回报'),
						),
						h('div', { className: 'fleet-console' },
							h('div', { className: 'fleet-console-bar' },
								h('div', { className: 'fleet-filters', role: 'group', 'aria-label': '筛选任务' },
									[['all', '全部'], ['waiting', '等待回报'], ['done', '已回报']].map(([key, label]) => h('button', {
										key, type: 'button', className: 'fleet-filter', 'aria-pressed': filter === key,
										onClick: () => { setFilter(key); setSelected(null) },
									}, label, h('small', null, counts[key]))),
								),
								scope !== null ? h('div', { className: 'fleet-scope' },
									h('span', null, '设备'),
									h('span', { className: 'fleet-scope-name', title: scope }, scope),
									h('button', { type: 'button', onClick: () => { setScope(null); setSelected(null) } }, '查看全部'),
								) : null,
							),
							filtered.length ? h('div', { className: 'fleet-missions' },
								h('div', { className: 'fleet-orders', role: 'group', 'aria-label': '任务列表' },
									filtered.map(t => h('button', {
										key: taskKey(t), type: 'button', className: 'fleet-order',
										'aria-pressed': taskKey(t) === taskKey(current),
										'aria-controls': 'fleet-mission-detail',
										onClick: () => setSelected(taskKey(t)),
									},
										h('span', { className: 'fleet-order-main' },
											h('span', { className: 'fleet-order-title' }, titleOf(t)),
											h('span', { className: 'fleet-order-sub' },
												h('span', { className: 'fleet-order-device', title: t.device }, t.device),
												h('span', { className: 'fleet-order-code fleet-mono' }, t.shortId),
											),
										),
										h('span', { className: 'fleet-order-side' },
											badge(...statusOf(t)),
											h('span', { className: 'fleet-order-time', title: time(t.at) }, `${age(Math.max(0, updatedAt - t.at))}派发`),
										),
									)),
									h('div', { className: 'fleet-orders-end' },
										h('span', null, `共 ${filtered.length} 项记录`),
										h('span', { className: 'fleet-mono' }, '按派发时间倒序'),
									),
								),
								current ? h('aside', { className: 'fleet-detail', id: 'fleet-mission-detail', 'aria-label': '任务详情' },
									h('div', { className: 'fleet-detail-bar' },
										h('span', { className: 'fleet-label' }, '任务详情'),
										badge(...statusOf(current)),
									),
									h('h3', null, titleOf(current)),
									h('div', { className: 'fleet-session' },
										h('span', { className: 'fleet-session-label' }, '会话编号'),
										h('span', { className: 'fleet-session-id fleet-mono' }, current.sessionId),
										h('button', { type: 'button', 'aria-label': copied === current.sessionId ? '会话编号已复制' : '复制会话编号', onClick: () => void copySession(current.sessionId) }, copied === current.sessionId ? '已复制' : '复制'),
										h('span', { className: 'fleet-sr', role: 'status' }, copied === current.sessionId ? '会话编号已复制' : ''),
									),
									h('dl', null,
										h('dt', null, '执行设备'), h('dd', null, current.device),
										h('dt', null, '派发时间'), h('dd', null, time(current.at)),
									),
									h('p', { className: 'fleet-detail-note' },
										current.status === 'done'
											? '回报已收到；结果与验收以原会话为准。'
											: current.status === 'stale'
												? '超过 30 分钟未收到回报，任务可能仍在执行。'
												: '派发记录已建立，尚未收到回报。',
										h('span', { className: 'fleet-detail-foot' },
											current.status === 'done'
												? '收到回报不代表验收通过。'
												: current.status === 'stale'
													? '可让指挥 Agent 确认进展。'
													: '这里不推测实时执行进度。',
										),
									),
								) : null,
							) : h('div', { className: 'fleet-empty-task' },
								art('standby-diorama'),
								h('h3', null, tasks.length ? '这个筛选下没有任务' : '舰队就位，等你下达任务'),
								h('p', null, tasks.length ? '换一个筛选条件，或回到全部设备查看。' : '回到与指挥 Agent 的对话，告诉它要交给哪台设备、完成什么。'),
								tasks.length ? button('查看全部任务', () => { setFilter('all'); setScope(null); setSelected(null) }, { className: 'fleet-btn fleet-btn-primary' }) : null,
							),
						),
						notices > 0 && recent.length > 0 ? h('details', { className: 'fleet-params' },
							h('summary', null, h('span', null, '最近回报'), h('small', null, `${notices} 份待 Agent 接收`)),
							h('div', { className: 'fleet-report-list' }, recent.map((n, i) => h('div', { className: 'fleet-report-item', key: `${n.sessionId}-${i}` },
								h('strong', null, n.title || n.shortId || '未命名会话'),
								h('small', null, `${n.device} · ${time(n.at)}`),
							))),
						) : null,
					),
				),
				h('footer', { className: 'fleet-footer' },
					h('span', null, updatedAt ? `上次同步 ${time(updatedAt)}${loadError ? ' · 数据可能已过期' : ' · 每 20 秒自动更新'}` : '等待首次同步'),
					h('span', { className: 'fleet-mono' }, 'FLEET / HOME DOCK'),
				),
			),
			toast ? h('div', { className: `fleet-toast ${toast.tone === 'error' ? 'is-error' : ''}` },
				h('div', { className: 'fleet-toast-copy', role: toast.tone === 'error' ? 'alert' : 'status' },
					h('p', null, toast.message),
					toast.tone === 'ok' && scanResults?.length ? h('div', { className: 'fleet-discovered' }, scanResults.map((w, i) => h('span', { key: `${w.name}-${i}` }, w.name || '未命名设备'))) : null,
				),
				h('button', { type: 'button', className: 'fleet-toast-close', 'aria-label': '关闭提示', onClick: () => { setActionError(''); setNotice(''); setScanResults(null) } }, '×'),
			) : null,
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
