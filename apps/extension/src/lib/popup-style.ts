export const POPUP_STYLE = `
@font-face{font-family:'Gideon Archivo';src:url(fonts/Archivo.woff2) format('woff2');font-weight:400 900;font-stretch:100% 125%}
@font-face{font-family:'Gideon Mono';src:url(fonts/JetBrainsMono.woff2) format('woff2');font-weight:400 700}
html,body{margin:0;background:#0C0B09}
.pp{display:block;width:380px;min-height:300px;padding:14px 14px 10px;background:var(--n-bg);
 background-image:radial-gradient(#1d1b16 1px,transparent 1px);background-size:14px 14px}
.hidden{display:none!important}
.top{display:flex;align-items:center;gap:8px;padding-bottom:12px;border-bottom:1px solid var(--n-line)}
.logo svg{width:24px;height:24px;color:var(--n-ink);display:block}
.word{font-weight:900;font-stretch:125%;font-size:15px;letter-spacing:.02em}
.net{margin-left:auto;display:flex;align-items:center;gap:6px;border:1px solid var(--n-line);border-radius:999px;padding:2px 4px 2px 10px;background:var(--n-surface)}
.net .dot{width:7px;height:7px;border-radius:50%;background:var(--safe)}
.net.main .dot{background:var(--amber)}
.net select{all:unset;font:500 11.5px var(--mono);color:var(--n-ink);padding:3px 6px;cursor:pointer}
.net select option{background:#15140F;color:#EFE8D8}
.sec{display:block;margin-top:14px}
.lab{font:600 10.5px var(--mono);letter-spacing:.12em;color:var(--n-muted);margin-bottom:8px;display:block}
.in{display:block;width:100%;height:34px;background:var(--n-surface);border:1px solid var(--n-line);border-radius:3px;color:var(--n-ink);font:13px var(--display);padding:0 10px;outline:none}
.in.mono{font-family:var(--mono);font-size:12.5px}
.in:focus{border-color:var(--amber)}
select.in option{background:#15140F}
.row{display:flex;gap:8px;margin-top:8px}.row>*{flex:1;min-width:0}
.go{display:flex;align-items:center;justify-content:space-between;width:100%;height:38px;margin-top:10px;border:0;border-radius:3px;background:var(--amber);color:#16120A;font:800 13.5px var(--display);font-stretch:110%;padding:0 12px;cursor:pointer}
.go span{animation:blink 1s steps(2) infinite}.go:disabled{opacity:.6;cursor:progress}
@keyframes blink{50%{opacity:0}}
.res:empty{display:none}
.last{border:1px solid var(--n-line);border-radius:4px;background:var(--n-surface);padding:9px 10px;font-size:12.5px;color:var(--n-ink-2)}
.last .h{display:flex;justify-content:space-between;gap:8px;font:11px var(--mono);color:var(--n-muted);margin-bottom:4px}
.last .t{color:var(--n-ink);font-weight:700}
.chip{font:700 10px var(--mono);letter-spacing:.08em;padding:2px 6px;border-radius:2px}
.chip.block{background:var(--signal);color:#fff}.chip.warn{background:var(--amber);color:#16120A}.chip.safe{background:var(--safe);color:#0C0B09}
.stats{display:grid;grid-template-columns:repeat(3,1fr);margin-top:14px;border:1px solid var(--n-line);border-radius:4px}
.stats div{padding:8px 10px;border-left:1px solid var(--n-line)}.stats div:first-child{border-left:0}
.stats b{display:block;font-weight:800;font-size:20px;font-stretch:110%}.stats b.v{color:var(--signal-ink)}
.stats span{font:600 9.5px var(--mono);letter-spacing:.12em;color:var(--n-muted)}
.tg{display:flex;align-items:center;gap:10px;padding:6px 0;font-size:12.5px;color:var(--n-ink-2);cursor:pointer}
.tg input{position:absolute;opacity:0;pointer-events:none}
.tg i{flex:none;width:30px;height:17px;border-radius:999px;background:#2C2922;position:relative;transition:background .15s}
.tg i::after{content:'';position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#857F71;transition:transform .15s,background .15s}
.tg input:checked+i{background:#3a2a0c}.tg input:checked+i::after{transform:translateX(13px);background:var(--amber)}
.tg input:focus-visible+i{outline:2px solid var(--amber);outline-offset:2px}
b.v{color:var(--signal-ink)}
.book summary{cursor:pointer;list-style:none}.book summary::-webkit-details-marker{display:none}
.book summary::after{content:' +';color:var(--amber)}.book[open] summary::after{content:' −'}
.hint{font-size:12px;color:var(--n-muted);margin-bottom:8px}
#clist{list-style:none}
#clist li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 0;border-top:1px solid #211F1A;font:12px var(--mono);color:var(--n-ink);overflow-wrap:anywhere}
#clist li b{color:var(--n-muted);font-weight:500}
#clist button{all:unset;cursor:pointer;font:11px var(--mono);color:var(--n-muted)}#clist button:hover{color:var(--signal-ink)}
.book .row .btn{flex:0 0 auto;height:34px}
.foot{display:flex;justify-content:space-between;margin-top:14px;padding-top:8px;border-top:1px solid var(--n-line);font:10.5px var(--mono);color:var(--n-muted)}
`;
