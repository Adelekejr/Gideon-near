export const POPUP_STYLE = `
@font-face{font-family:'Gideon Archivo';src:url(fonts/Archivo.woff2) format('woff2');font-weight:100 900;font-stretch:62% 125%}
@font-face{font-family:'Gideon Mono';src:url(fonts/JetBrainsMono.woff2) format('woff2');font-weight:100 800}
html,body{margin:0;background:#0C0B09}
html[data-theme=day],html[data-theme=day] body{background:#F2F0EB}
html[data-theme=plan],html[data-theme=plan] body{background:#10283F}
html[data-theme=signal],html[data-theme=signal] body{background:#FFF}
.pp{display:block;width:380px;min-height:300px;padding:14px 14px 10px;background:var(--bg);position:relative;overflow-wrap:anywhere}
.pp[data-theme=plan]{background-image:linear-gradient(rgba(155,209,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(155,209,255,.07) 1px,transparent 1px);background-size:24px 24px}
.hidden{display:none!important}
.top{display:flex;align-items:center;gap:8px;padding-bottom:12px;border-bottom:1px solid var(--line)}
.logo svg{width:26px;height:26px;color:var(--ink);display:block}
.word{font-weight:900;font-stretch:125%;font-size:15px;letter-spacing:.03em}
.net{margin-left:auto;display:flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:2px;padding:2px 4px 2px 9px;background:var(--surface)}
.net .dot{width:7px;height:7px;border-radius:50%;background:var(--safe)}
.net.main .dot{background:var(--attention)}
.net select{all:unset;font:600 11px var(--mono);letter-spacing:.06em;color:var(--ink);padding:3px 6px;cursor:pointer}
.net select option{background:var(--surface);color:var(--ink)}
.shifts{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}
.rail{position:relative;display:inline-grid;grid-auto-flow:column;border:1px solid var(--line);border-radius:2px;background:var(--surface)}
.rail button{all:unset;cursor:pointer;font:600 9.5px var(--mono);letter-spacing:.12em;padding:6px 7px;color:var(--mute);position:relative;z-index:1;transition:color .2s}
.rail button[aria-checked=true]{color:var(--bg);background:var(--ink)}
.rail button:focus-visible{outline:2px solid var(--acc);outline-offset:-2px}
.autonote{font:500 9.5px var(--mono);letter-spacing:.06em;color:var(--mute);text-align:right;line-height:1.3}
.sec{display:block;margin-top:14px}
.lab{font:600 10px var(--mono);letter-spacing:.14em;color:var(--mute);margin-bottom:8px;display:block;text-transform:uppercase}
.in{display:block;width:100%;height:34px;background:var(--surface);border:1px solid var(--line);border-radius:2px;color:var(--ink);font:13px var(--display);padding:0 10px;outline:none}
.in.mono{font-family:var(--mono);font-size:12.5px}
.in::placeholder{color:var(--mute)}
.in:focus{border-color:var(--ink);box-shadow:0 0 0 1px var(--ink)}
select.in option{background:var(--surface);color:var(--ink)}
.row{display:flex;gap:8px;margin-top:8px}.row>*{flex:1;min-width:0}
.go{display:flex;align-items:center;justify-content:space-between;width:100%;height:40px;margin-top:10px;border:0;border-radius:2px;background:var(--ink);color:var(--bg);font:800 13.5px var(--display);font-stretch:112%;padding:0 12px;cursor:pointer}
.go .ar{font-family:var(--mono);transition:transform .25s cubic-bezier(.2,.8,.2,1)}.go:hover .ar{transform:translateX(3px)}
.go:disabled{opacity:.6;cursor:progress}
.res{margin-top:14px}.res:empty{display:none}
.last{border:1px solid var(--line);border-radius:2px;background:var(--surface);padding:9px 10px;font-size:12.5px;color:var(--ink2)}
.last .h{display:flex;justify-content:space-between;align-items:center;gap:8px;font:11px var(--mono);color:var(--mute);margin-bottom:5px}
.last .t{color:var(--ink);font-weight:700}
.stats{display:grid;grid-template-columns:repeat(3,1fr);margin-top:14px;border:1px solid var(--line);border-radius:2px}
.stats div{padding:8px 10px;border-left:1px solid var(--line)}.stats div:first-child{border-left:0}
.stats b{display:block;font-weight:800;font-size:22px;font-stretch:112%;font-variant-numeric:tabular-nums}
.stats span{font:600 9px var(--mono);letter-spacing:.14em;color:var(--mute)}
b.v{color:var(--blocked)}
.tg{display:flex;align-items:center;gap:10px;padding:6px 0;font-size:12.5px;color:var(--ink2);cursor:pointer}
.tg input{position:absolute;opacity:0;pointer-events:none}
.tg i{flex:none;width:30px;height:17px;border-radius:2px;background:var(--soft);box-shadow:inset 0 0 0 1px var(--line);position:relative;transition:background .15s}
.tg i::after{content:'';position:absolute;top:3px;left:3px;width:11px;height:11px;border-radius:1px;background:var(--mute);transition:transform .2s cubic-bezier(.2,.8,.2,1),background .15s}
.tg input:checked+i{background:var(--ink)}.tg input:checked+i::after{transform:translateX(13px);background:var(--bg)}
.tg input:focus-visible+i{outline:2px solid var(--acc);outline-offset:2px}
.book summary{cursor:pointer;list-style:none}.book summary::-webkit-details-marker{display:none}
.book summary::after{content:' +';color:var(--acc)}.book[open] summary::after{content:' −'}
.hint{font-size:12px;color:var(--mute);margin-bottom:8px}
#clist,#mlist{list-style:none}
#clist li,#mlist li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 0;border-top:1px solid var(--line);font:12px var(--mono);color:var(--ink);overflow-wrap:anywhere}
#clist li b,#mlist li b{color:var(--mute);font-weight:500}
#clist button,#mlist button{all:unset;cursor:pointer;font:11px var(--mono);color:var(--mute);text-decoration:underline}#clist button:hover,#mlist button:hover{color:var(--ink)}
.book .row .btn{flex:0 0 auto;height:34px}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:9px;border-top:1px solid var(--line);font:10px var(--mono);letter-spacing:.04em;color:var(--mute)}
.built{display:inline-flex;align-items:center;gap:7px}
.near{height:13px;width:auto;display:none}
.pp[data-theme=day] .near.on-light,.pp[data-theme=signal] .near.on-light{display:block}
.pp[data-theme=night] .near.on-dark,.pp[data-theme=plan] .near.on-dark{display:block}
@media (prefers-reduced-motion:reduce){.pp *{transition:none!important}}
`;
