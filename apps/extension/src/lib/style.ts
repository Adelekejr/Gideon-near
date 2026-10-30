/** Shared styles for the popup and the in-page warning card (inside a closed shadow root).
 *  Same type and colour shifts as the website. Status colours never change between shifts:
 *  vermilion = BLOCKED and nothing else · amber = ATTENTION (incl. couldn't check) · green = SAFE. */
export const STYLE = `
:host,.g-root{all:initial}
.g-root,.g-root *{box-sizing:border-box;margin:0;padding:0}
.g-root{--blocked:#FF4D1A;--attention:#F4B400;--safe:#2DB36F;--on-status:#111210;
 --display:'Gideon Archivo','Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;--mono:'Gideon Mono','JetBrains Mono',ui-monospace,Menlo,monospace;
 --bg:#0C0B09;--surface:#15140F;--ink:#EFE8D8;--ink2:#B8B1A1;--mute:#8F8878;--line:rgba(239,232,216,.16);--soft:rgba(239,232,216,.045);--acc:#FFB547;--on-acc:#111210;
 font-family:var(--display);color:var(--ink);font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}
.g-root[data-theme=day]{--bg:#F2F0EB;--surface:#FBFAF6;--ink:#111210;--ink2:#3D3B35;--mute:#6E6A60;--line:rgba(17,18,16,.16);--soft:rgba(17,18,16,.05);--acc:#9A6200;--on-acc:#FFFFFF}
.g-root[data-theme=night]{--bg:#0C0B09;--surface:#15140F;--ink:#EFE8D8;--ink2:#B8B1A1;--mute:#8F8878;--line:rgba(239,232,216,.16);--soft:rgba(239,232,216,.045);--acc:#FFB547;--on-acc:#111210}
.g-root[data-theme=plan]{--bg:#10283F;--surface:#0D2236;--ink:#E6F0F7;--ink2:#B9CFE0;--mute:#86A3BC;--line:rgba(155,209,255,.22);--soft:rgba(155,209,255,.06);--acc:#9BD1FF;--on-acc:#10283F}
.g-root[data-theme=signal]{--bg:#FFFFFF;--surface:#FFFFFF;--ink:#000;--ink2:#1A1A1A;--mute:#3A3A3A;--line:#000;--soft:rgba(0,0,0,.04);--acc:#000;--on-acc:#FFF}
.mono{font-family:var(--mono)}
/* Arrow G: poses are the final frames of playVerdict() */
.gs{display:block;flex:none;overflow:visible;color:var(--ink)}
.gs *{transform-box:view-box;transform-origin:0 0}
.gs .gs-g{fill:none;stroke:currentColor;stroke-width:13}
.gs .gs-arw{fill:currentColor}
.gs .gs-wall{fill:var(--mute)}
.gs .gs-hit{fill:none;stroke-width:3;stroke-linecap:square;opacity:0}
.gs.block .gs-wall{fill:var(--blocked)}.gs.block .gs-hit{stroke:var(--blocked);opacity:1}.gs.block .gs-arw{transform:translateX(-4px)}
.gs.warn .gs-wall{fill:var(--attention)}.gs.warn .gs-arw{transform:translateX(4px)}
.gs.safe .gs-wall{fill:var(--safe);transform:translateY(30px);opacity:0}.gs.safe .gs-arw{fill:var(--safe)}
.gs.idle .gs-arw{animation:gs-wait 1.1s cubic-bezier(.2,.8,.2,1) infinite alternate}
@keyframes gs-wait{from{transform:translateX(-6px)}to{transform:translateX(1px)}}
@media (prefers-reduced-motion:reduce){.gs.idle .gs-arw{animation:none}}
/* status chips: solid fill, dark ink, same on every shift */
.chip{display:inline-flex;align-items:center;gap:6px;font:700 10px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;padding:5px 7px;border-radius:2px;white-space:nowrap;color:var(--on-status);background:var(--mute)}
.chip.block{background:var(--blocked)}.chip.warn{background:var(--attention)}.chip.safe{background:var(--safe)}
.chip.idle{background:transparent;color:var(--mute);box-shadow:inset 0 0 0 1px var(--line)}
/* the warning card */
.gw{position:relative;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:4px;overflow:hidden;overflow-wrap:anywhere;box-shadow:0 22px 50px -18px rgba(0,0,0,.5)}
.gw::before{content:'';position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--mute)}
.gw.t-block::before{background:var(--blocked)}.gw.t-warn::before{background:var(--attention)}.gw.t-safe::before{background:var(--safe)}
.gh{display:flex;align-items:center;gap:12px;padding:12px 14px 10px 19px;border-bottom:1px solid var(--line)}
.gst{flex:none;width:52px;height:52px;display:grid;place-items:center;border:1px solid var(--line);background:var(--soft);border-radius:2px}
.gst .gs{width:38px;height:38px}
.ghm{flex:1;min-width:0}
.ghr{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ghr b{font-weight:800;font-stretch:125%;font-size:11px;letter-spacing:.06em}
.gt{font-weight:800;font-stretch:105%;font-size:16px;letter-spacing:-.01em;line-height:1.2;margin-top:6px}
.gb{padding:10px 14px 12px 19px}
.gr{font-size:13px;color:var(--ink2);line-height:1.45}
.gf{font:12px var(--mono);margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);color:var(--ink);overflow-wrap:anywhere}
.gn{font:11px var(--mono);margin-top:8px;color:var(--ink2);overflow-wrap:anywhere}
.gn b{font-weight:700;color:var(--ink)}.gn+.gn{margin-top:3px}
.gf b,.ga b{font-weight:700;color:var(--acc)}.gf a{color:inherit;text-decoration:underline}
.ga{font:11.5px var(--mono);margin-top:8px;color:var(--mute);overflow-wrap:anywhere}
.more{margin-top:10px}
.more summary{cursor:pointer;font:11.5px var(--mono);color:var(--mute)}
.fl{list-style:none;margin-top:8px}
.fl li{display:flex;gap:8px;font-size:12.5px;padding:4px 0;border-top:1px solid var(--line);color:var(--ink2)}
.fl li i{font:700 11px var(--mono);width:14px;font-style:normal;text-align:center}
.fl li b{font:600 11px var(--mono);color:var(--mute);margin-right:4px}
.fl .s-blocked i{color:var(--blocked)}.fl .s-attention i,.fl .s-could_not_check i{color:var(--attention)}.fl .s-pass i{color:var(--safe)}
.gacts,.ga.act{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.gacts button,.ga.act button,.btn{font:600 11.5px var(--mono);letter-spacing:.04em;height:30px;padding:0 11px;border-radius:2px;border:1px solid var(--ink);background:var(--ink);color:var(--bg);cursor:pointer}
.gacts button.g,.ga.act button.g,.btn.g{background:transparent;color:var(--ink);border-color:var(--line)}
.gacts button:focus-visible,.btn:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.gmark{display:flex;justify-content:space-between;align-items:center;padding:6px 14px 6px 19px;border-top:1px solid var(--line);font:500 9.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--mute)}
`;
/** Kept for compatibility with older imports; the poses above already cover warn. */
export const STYLE_WARN_FIX = ``;
