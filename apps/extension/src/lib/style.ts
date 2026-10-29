/** Shared night-watch styles (Direction C). Injected into the popup and into the in-page shadow root. */
export const STYLE = `
:host,.g-root{all:initial}
.g-root,.g-root *{box-sizing:border-box;margin:0;padding:0}
.g-root{--n-bg:#0C0B09;--n-surface:#15140F;--n-line:#2C2922;--n-ink:#EFE8D8;--n-ink-2:#B8B1A1;--n-muted:#857F71;
 --amber:#FFB547;--signal:#FF4D1A;--signal-ink:#FF7A50;--safe:#3FCF7F;
 --display:'Gideon Archivo','Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;--mono:'Gideon Mono','JetBrains Mono',ui-monospace,Menlo,monospace;
 font-family:var(--display);color:var(--n-ink);font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}
.mono{font-family:var(--mono)}
/* stopper */
.gs{--arw:var(--n-ink);--wall:var(--signal);--ok:var(--safe);overflow:hidden;display:block;flex:none}
.gs.t-warn{--wall:var(--amber)}.gs.t-idle{--wall:var(--amber)}
.gs-arw{fill:var(--arw)}
.gs-wall{fill:var(--wall);transform-box:fill-box;transform-origin:50% 100%}
.gs-hit{stroke:var(--wall);stroke-width:4;stroke-linecap:square;fill:none;opacity:0}
.gs.block .gs-arw{animation:gs-ab 3.6s infinite}.gs.block .gs-wall{animation:gs-wb 3.6s infinite}.gs.block .gs-hit{animation:gs-hb 3.6s infinite}
.gs.safe .gs-arw{animation:gs-as 3.6s infinite}.gs.safe .gs-wall{animation:gs-ws 3.6s infinite}
.gs.idle .gs-wall{animation:gs-pulse 1.1s ease-in-out infinite alternate}
@keyframes gs-ab{0%{transform:translateX(-80px);opacity:0;animation-timing-function:cubic-bezier(.55,0,.9,.5)}10%{opacity:1}36%{transform:translateX(10px);animation-timing-function:cubic-bezier(.1,.9,.3,1)}50%{transform:translateX(-30px)}58%{transform:translateX(-18px)}64%,90%{transform:translateX(-22px);opacity:1}100%{transform:translateX(-22px);opacity:0}}
@keyframes gs-wb{0%,36%{transform:translateX(0)}39%{transform:translateX(6px)}43%{transform:translateX(-5px)}47%{transform:translateX(4px)}51%{transform:translateX(-2px)}55%,100%{transform:translateX(0)}}
@keyframes gs-hb{0%,35%{opacity:0}38%{opacity:1}54%,100%{opacity:0}}
@keyframes gs-as{0%{transform:translateX(-80px);opacity:0;animation-timing-function:cubic-bezier(.3,0,.4,1)}10%{opacity:1}30%,44%{transform:translateX(-4px);animation-timing-function:cubic-bezier(.5,0,.75,0)}72%{transform:translateX(110px);opacity:1}76%,100%{transform:translateX(120px);opacity:0}}
@keyframes gs-ws{0%,26%{transform:translateY(0);fill:var(--wall)}32%{transform:translateY(0);fill:var(--ok)}44%,76%{transform:translateY(-82px);fill:var(--ok);animation-timing-function:cubic-bezier(.6,0,.4,1)}90%,100%{transform:translateY(0);fill:var(--wall)}}
@keyframes gs-pulse{from{opacity:.45}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.gs *{animation:none!important}.gs.block .gs-arw{transform:translateX(-22px)}.gs.block .gs-hit{opacity:1}.gs.safe .gs-wall{fill:var(--ok);transform:translateY(-50px)}}
/* verdict card (the night-watch warning) */
.gw{background:var(--n-bg);color:var(--n-ink);border:1.5px solid var(--amber);border-radius:8px;overflow:hidden;box-shadow:0 18px 50px -14px rgba(0,0,0,.6)}
.gw.t-block{border-color:var(--signal);box-shadow:0 18px 50px -14px rgba(255,77,26,.55)}
.gw.t-warn{border-color:var(--amber);box-shadow:0 18px 50px -14px rgba(255,181,71,.45)}
.gw.t-safe{border-color:var(--safe);box-shadow:0 18px 50px -14px rgba(63,207,127,.4)}
.gw.t-idle{border-color:var(--n-line)}
.gh{display:flex;align-items:center;gap:10px;padding:7px 12px;background:var(--n-surface);color:var(--n-ink)}
.t-block .gh{background:var(--signal);color:#fff}.t-block .gh .gs{--arw:#16120A;--wall:#fff}
.t-warn .gh{background:var(--amber);color:#16120A}.t-warn .gh .gs{--arw:#16120A;--wall:#16120A}
.t-safe .gh{background:var(--safe);color:#0C0B09}.t-safe .gh .gs{--arw:#0C0B09;--wall:#0C0B09;--ok:#0C0B09}
.gh .gs{width:54px;height:24px}
.gh b{font-weight:800;font-stretch:125%;font-size:12px;letter-spacing:.02em}
.gh span{margin-left:auto;font:700 10.5px var(--mono);letter-spacing:.1em}
.gb{padding:12px 14px}
.gt{font-weight:800;font-stretch:108%;font-size:16px;letter-spacing:-.2px;line-height:1.2}
.gr{font-size:13px;color:var(--n-ink-2);margin-top:4px;line-height:1.45}
.gf{font:12px var(--mono);margin-top:10px;padding-top:10px;border-top:1px dashed var(--n-line);color:var(--n-ink);overflow-wrap:anywhere}
.t-block .gf b{color:var(--signal-ink)}.t-warn .gf b{color:var(--amber)}.t-safe .gf b{color:var(--safe)}
.more{margin-top:10px}
.more summary{cursor:pointer;font:11.5px var(--mono);color:var(--n-muted)}
.fl{list-style:none;margin-top:8px}
.fl li{display:flex;gap:8px;font-size:12.5px;padding:4px 0;border-top:1px solid #211F1A;color:var(--n-ink-2)}
.fl li i{font:700 11px var(--mono);width:14px;font-style:normal}
.fl li b{font:600 11px var(--mono);color:var(--n-muted);margin-right:4px}
.fl .s-blocked i{color:var(--signal-ink)}.fl .s-attention i,.fl .s-could_not_check i{color:var(--amber)}.fl .s-pass i{color:var(--safe)}
.ga{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.ga button,.btn{font:500 12px var(--mono);height:30px;padding:0 10px;border-radius:2px;border:1px solid var(--amber);background:var(--amber);color:#16120A;cursor:pointer}
.ga button.g,.btn.g{background:transparent;color:var(--n-ink-2);border-color:var(--n-line)}
.ga button:focus-visible,.btn:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
`;
export const STYLE_WARN_FIX = `.gs.t-warn .gs-wall{animation:none}`;
