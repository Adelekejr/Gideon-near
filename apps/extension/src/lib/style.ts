/** Shared styles for the popup and the in-page warning card (inside a closed shadow root).
 *  Same type and light/dark themes as the website.
 *  Red is BLOCKED and nothing else. Amber is look again or couldn't check. Green is no problems found. */
export const STYLE = `
:host,.g-root{all:initial}
.g-root,.g-root *{box-sizing:border-box;margin:0;padding:0}
.g-root{--b:#D42A10;--bInk:#fff;--bText:#B3230B;--bTint:#FBE4DD;--a:#E8A400;--aInk:#16150F;--aText:#855800;--aTint:#FBF0D2;--s:#4FB57A;--sInk:#0B2416;--sText:#1F6E42;--sTint:#DFF1E5;
 --blocked:var(--b);--attention:var(--a);--safe:var(--s);--on-status:var(--bInk);
 --display:'Bricolage Grotesque',system-ui,-apple-system,'Segoe UI',sans-serif;--serif:'Newsreader',Georgia,serif;--mono:'JetBrains Mono',ui-monospace,Menlo,monospace;
 --bg:#F5F3EE;--surface:#FCFBF8;--raised:#fff;--ink:#16150F;--ink2:#3B382F;--mute:#5E5A50;--line:rgba(22,21,15,.12);--lineS:#16150F;--soft:rgba(22,21,15,.05);--focus:#2F5BD3;--acc:var(--focus);
 font-family:var(--display);color:var(--ink);font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased;background:var(--bg)}
.g-root[data-theme=light]{--bg:#F5F3EE;--surface:#FCFBF8;--raised:#fff;--ink:#16150F;--ink2:#3B382F;--mute:#5E5A50;--line:rgba(22,21,15,.12);--lineS:#16150F;--soft:rgba(22,21,15,.05);--focus:#2F5BD3;
 --b:#D42A10;--bInk:#fff;--bText:#B3230B;--bTint:#FBE4DD;--a:#E8A400;--aInk:#16150F;--aText:#855800;--aTint:#FBF0D2;--s:#4FB57A;--sInk:#0B2416;--sText:#1F6E42;--sTint:#DFF1E5}
.g-root[data-theme=dark]{--bg:#0E0E0C;--surface:#171714;--raised:#1F1F1B;--ink:#EDEAE2;--ink2:#C9C5BA;--mute:#8F8A7E;--line:rgba(237,234,226,.12);--lineS:#EDEAE2;--soft:rgba(237,234,226,.05);--focus:#7FA2FF;
 --b:#FF5A36;--bInk:#0E0E0C;--bText:#FF6A48;--bTint:rgba(255,90,54,.14);--a:#F2B01E;--aInk:#0E0E0C;--aText:#F2B01E;--aTint:rgba(242,176,30,.13);--s:#4FB57A;--sInk:#0B2416;--sText:#5CC088;--sTint:rgba(92,192,136,.13)}
.mono{font-family:var(--mono)}
.gs{display:block;flex:none;overflow:visible;color:var(--ink)}
.gs .gs-arc{fill:none;stroke:currentColor;stroke-width:7;stroke-linecap:round}
.gs .gs-bar,.gs .gs-ghost,.gs .gs-out{transform-box:view-box;transform-origin:40px 24px}
.gs .gs-bar{fill:currentColor}
.gs .gs-ghost{fill:var(--lineS);opacity:0}
.gs .gs-out{fill:none;stroke:var(--a);stroke-width:3;opacity:0}
.gs .gs-pivot{fill:currentColor}
.gs.idle .gs-ghost{opacity:.28}
.gs.idle .gs-bar{animation:gate-rock 1.1s cubic-bezier(.4,0,.2,1) infinite alternate}
@keyframes gate-rock{from{transform:rotate(0)}to{transform:rotate(20deg)}}
.gs.block .gs-bar{fill:var(--b);transform:rotate(0)}
.gs.warn .gs-bar{fill:var(--a);transform:rotate(45deg)}
.gs.warn.cnc .gs-bar{opacity:0}
.gs.warn.cnc .gs-out{opacity:1}
.gs.safe .gs-bar{fill:var(--s);transform:rotate(90deg)}
@media (prefers-reduced-motion:reduce){.gs.idle .gs-bar{animation:none;transform:rotate(20deg)}}
.chip{display:inline-flex;align-items:center;gap:6px;font:600 10px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;height:22px;padding:0 7px;border-radius:5px;white-space:nowrap;color:var(--ink2);background:var(--soft)}
.chip::before{content:"";width:6px;height:6px;background:currentColor;flex:none}
.chip.block{background:var(--b);color:var(--bInk)}.chip.warn{background:var(--a);color:var(--aInk)}.chip.safe{background:var(--s);color:var(--sInk)}
.chip.warn::before{width:5px;height:5px;transform:rotate(45deg)}
.chip.safe::before{border-radius:50%}
.chip.idle{background:transparent;color:var(--mute);box-shadow:inset 0 0 0 1px var(--line)}
.chip.idle::before{background:transparent;border:1.5px solid currentColor;border-radius:50%;width:5px;height:5px}
.gw{position:relative;background:var(--raised);color:var(--ink);border:1px solid var(--line);border-left:4px solid var(--mute);border-radius:10px;overflow:visible;overflow-wrap:anywhere;box-shadow:var(--shadow,0 8px 24px rgba(22,21,15,.08))}
.gw.t-block{border-left-color:var(--b)}.gw.t-warn{border-left-color:var(--a)}.gw.t-safe{border-left-color:var(--s)}
.gh{display:flex;align-items:flex-start;gap:10px;padding:14px 14px 0 12px}
.gst{flex:none;width:40px;height:40px;display:grid;place-items:center;border-radius:8px;background:var(--bg);overflow:visible}
.gst .gs{width:28px;height:28px}
.ghm{flex:1;min-width:0}
.ghr{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ghr b{font-weight:700;font-size:12px;letter-spacing:.04em}
.gt{font-weight:600;font-size:16.5px;letter-spacing:-.01em;line-height:1.2;margin-top:4px}
.gb{padding:10px 14px 12px 12px}
.gr{font-size:13.5px;color:var(--ink2);line-height:1.45}
.gf{font:12px var(--mono);margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);color:var(--ink);overflow-wrap:anywhere}
.gn{font:11.5px var(--mono);margin-top:8px;color:var(--ink2);overflow-wrap:anywhere}
.gn b{font-weight:700;color:var(--ink)}.gn+.gn{margin-top:3px}
.gf b,.ga b{font-weight:700;color:var(--ink)}.gf a{color:inherit;text-decoration:underline}
.ga{font:11.5px var(--mono);margin-top:8px;color:var(--mute);overflow-wrap:anywhere}
.more{margin-top:10px}
.more summary{cursor:pointer;font:12px var(--mono);color:var(--ink2)}
.fl{list-style:none;margin-top:8px}
.fl li{display:flex;gap:8px;font-size:12.5px;padding:4px 0;border-top:1px solid var(--line);color:var(--ink2)}
.fl li i{font:700 11px var(--mono);width:14px;font-style:normal;text-align:center}
.fl li b{font:600 11px var(--mono);color:var(--mute);margin-right:4px}
.fl .s-blocked i{color:var(--b)}.fl .s-attention i,.fl .s-could_not_check i{color:var(--a)}.fl .s-pass i{color:var(--s)}
.gacts,.ga.act{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.gacts button,.ga.act button,.btn{font:600 13px var(--display);height:40px;padding:0 12px;border-radius:9px;border:1px solid transparent;background:var(--ink);color:var(--bg);cursor:pointer}
.gacts button.g,.ga.act button.g,.btn.g{background:var(--raised);color:var(--ink);border-color:var(--line)}
.gacts button:focus-visible,.btn:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.gacts a.btn{display:inline-flex;align-items:center;text-decoration:none}.gacts .btn:disabled{opacity:.45;cursor:not-allowed}
.gmark{display:flex;justify-content:space-between;align-items:center;padding:6px 14px 8px 12px;border-top:1px solid var(--line);font:500 10px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.tg{display:flex;align-items:flex-start;gap:10px;margin-top:8px;font-size:13px;color:var(--ink2)}
.tg input{margin-top:3px}
`;
/** Kept for compatibility with older imports. */
export const STYLE_WARN_FIX = ``;
