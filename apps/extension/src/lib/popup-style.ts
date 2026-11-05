export const POPUP_STYLE = `
@font-face{font-family:'Bricolage Grotesque';src:url(fonts/Bricolage.woff2) format('woff2');font-weight:200 800;font-stretch:75% 100%;font-display:swap}
@font-face{font-family:'Newsreader';src:url(fonts/Newsreader.woff2) format('woff2');font-weight:200 800;font-display:swap}
@font-face{font-family:'Newsreader';src:url(fonts/Newsreader-Italic.woff2) format('woff2');font-weight:200 800;font-style:italic;font-display:swap}
@font-face{font-family:'JetBrains Mono';src:url(fonts/JetBrainsMono.woff2) format('woff2');font-weight:100 800;font-display:swap}
html,body{margin:0;background:#F5F3EE;color-scheme:light}
html[data-theme=dark],html[data-theme=dark] body{background:#0E0E0C;color-scheme:dark}
.pp{display:block;width:380px;min-height:300px;padding:0 0 12px;background:var(--bg);position:relative;overflow-wrap:anywhere}
.hidden{display:none!important}
.top{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--line)}
.logo svg{width:26px;height:26px;color:var(--ink);display:block}
.word{font-weight:800;font-size:18px;letter-spacing:-.03em}
.net{margin-left:auto;display:flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:8px;padding:2px 6px 2px 10px;background:var(--surface)}
.net .dot{width:7px;height:7px;border-radius:50%;background:var(--s)}
.net.main .dot{background:var(--a)}
.net select{all:unset;font:500 13px var(--display);color:var(--ink);padding:4px 4px;cursor:pointer}
.net select option{background:var(--surface);color:var(--ink)}
.themes{display:flex;align-items:center;padding:10px 16px 0}
.seg{display:flex;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:3px}
.seg button{all:unset;cursor:pointer;font:500 13px var(--display);padding:0 12px;height:32px;border-radius:7px;color:var(--mute)}
.seg button[aria-checked=true]{background:var(--raised);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.seg button:focus-visible{outline:2px solid var(--focus);outline-offset:1px}
.sec{display:block;margin-top:14px;padding:0 16px}
.lab{font:600 11px var(--mono);letter-spacing:.08em;color:var(--mute);margin-bottom:8px;display:block;text-transform:uppercase}
.in{display:block;width:100%;height:40px;background:var(--raised);border:1px solid var(--line);border-radius:9px;color:var(--ink);font:13px var(--display);padding:0 10px;outline:none}
.in.mono{font-family:var(--mono);font-size:12.5px}
.in::placeholder{color:var(--mute)}
.in:focus{border-color:var(--ink);box-shadow:0 0 0 1px var(--ink)}
select.in option{background:var(--surface);color:var(--ink)}
.row{display:flex;gap:8px;margin-top:8px}.row>*{flex:1;min-width:0}
.go{display:flex;align-items:center;justify-content:space-between;width:100%;height:44px;margin-top:10px;border:0;border-radius:9px;background:var(--ink);color:var(--bg);font:600 15px var(--display);padding:0 14px;cursor:pointer}
.go .ar{font-family:var(--mono);transition:transform .25s cubic-bezier(.2,.8,.2,1)}.go:hover .ar{transform:translateX(3px)}
.go:disabled{opacity:.6;cursor:progress}
.res{margin-top:14px}.res:empty{display:none}
.last{border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:10px 12px;font-size:13px;color:var(--ink2)}
.last .h{display:flex;justify-content:space-between;align-items:center;gap:8px;font:11px var(--mono);color:var(--mute);margin-bottom:5px}
.last .t{color:var(--ink);font-weight:600}
.stats{display:grid;grid-template-columns:repeat(3,1fr);margin:14px 16px 0;border:1px solid var(--line);border-radius:10px}
.stats div{padding:10px 12px;border-left:1px solid var(--line)}.stats div:first-child{border-left:0}
.stats b{display:block;font-weight:600;font-size:22px;font-variant-numeric:tabular-nums}
.stats span{font:600 10px var(--mono);letter-spacing:.08em;color:var(--mute)}
b.v{color:var(--b)}
.tg{display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13px;color:var(--ink2);cursor:pointer}
.tg input{position:absolute;opacity:0;pointer-events:none}
.tg i{flex:none;width:36px;height:22px;border-radius:11px;background:var(--soft);box-shadow:inset 0 0 0 1px var(--line);position:relative}
.tg i::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--mute);transition:transform .2s cubic-bezier(.2,.8,.2,1),background .15s}
.tg input:checked+i{background:var(--ink)}.tg input:checked+i::after{transform:translateX(14px);background:var(--bg)}
.tg input:focus-visible+i{outline:2px solid var(--focus);outline-offset:2px}
.book summary{cursor:pointer;list-style:none}.book summary::-webkit-details-marker{display:none}
.book summary::after{content:' +';color:var(--ink)}.book[open] summary::after{content:' −'}
.hint{font-size:13px;color:var(--mute);margin-bottom:8px;font-family:var(--serif)}
#clist,#mlist{list-style:none}
#clist li,#mlist li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--line);font:12px var(--mono);color:var(--ink);overflow-wrap:anywhere}
#clist li b,#mlist li b{color:var(--mute);font-weight:500}
#clist button,#mlist button{all:unset;cursor:pointer;font:11px var(--mono);color:var(--mute);text-decoration:underline}#clist button:hover,#mlist button:hover{color:var(--ink)}
.book .row .btn{flex:0 0 auto;height:40px}
.foot{display:flex;justify-content:space-between;align-items:center;margin:14px 16px 0;padding-top:10px;border-top:1px solid var(--line);font:11px var(--mono);color:var(--mute)}
.built{display:inline-flex;align-items:center;gap:7px}
.near{height:13px;width:auto;display:none}
.pp[data-theme=light] .near.on-light,.g-root[data-theme=light] .near.on-light{display:block}
.pp[data-theme=dark] .near.on-dark,.g-root[data-theme=dark] .near.on-dark{display:block}
@media (prefers-reduced-motion:reduce){.pp *{transition:none!important;animation:none!important}}
`;
