import { CHAT_SIZE_PX } from '@crm/contracts';
import { jsString } from './embed-script';
import { flbPhoneCountries } from '@crm/contracts';
import { CHAT_TEXT, RTL_LOCALES } from './chat-page-text';

/**
 * The chat page the launcher's iframe loads (TW-WGT-009): a self-contained document with its own style and script, no
 * application shell, no sign-in cookie. Everything it shows comes from `api/config`; this file only holds the frame.
 *
 * Visitor text is always put in with `textContent`, colours and the background image go through style properties after
 * the script has checked them, so nothing a visitor or an admin typed is ever interpreted as markup.
 */

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface ChatPageWidget {
  uuid: string;
  token: string;
  /** The internal name: it is the document title, as in Reference. */
  name: string;
  /** A flow bot's chat window: it gets a close button of its own inside the site's panel. */
  flow?: boolean;
  /** The visitor's language (one of the app's 21): the window's own words come in it. English when missing. */
  locale?: string;
  /** The Customize preview: the window draws what its parent sends it (no network, no conversation). */
  preview?: boolean;
}

const STYLE = `
* { box-sizing: border-box; }
:root { --accent: #5B4DDB; --accent-ink: #FFFFFF; --accent-soft: #EFEDFB; --accent-line: #C9C3F3; }
html, body { margin: 0; padding: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; height: 100%; -webkit-font-smoothing: antialiased; }
body { display: flex; flex-direction: column; background: #fff; }
/* Opened on its own (the preview link, a test), the chat is the real window: the size the author chose, in the middle of a plain page. */
html.standalone { background: #e9ebf5; }
html.standalone body { width: var(--win-w); max-width: calc(100% - 32px); height: min(var(--win-h), calc(100% - 48px)); margin: 24px auto; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 60px rgba(24,26,54,.24); position: relative; }
@media (max-width: 480px) { html.standalone { background: #fff; } html.standalone body { width: auto; max-width: none; height: 100%; margin: 0; border-radius: 0; box-shadow: none; } }
@keyframes rowIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes dot { 0%, 60%, 100% { opacity: .3; transform: none; } 30% { opacity: 1; transform: translateY(-3px); } }
@media (prefers-reduced-motion: reduce) { .row, .chips, .typing i { animation: none !important; } .body { scroll-behavior: auto !important; } }
.header { display: flex; align-items: center; gap: 12px; padding: 14px 16px; flex: none; }
.header .av { position: relative; width: 42px; height: 42px; flex: none; border-radius: 50%; background: rgba(255,255,255,.2); display: grid; place-items: center; }
.header .av i { position: absolute; right: 0; bottom: 0; width: 11px; height: 11px; border-radius: 50%; background: #22c58b; border: 2px solid var(--hdr, #5B4DDB); }
.header .hx { flex: none; width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: inherit; display: grid; place-items: center; cursor: pointer; opacity: .9; }
.header .hx:hover { background: rgba(255,255,255,.18); opacity: 1; }
.header .ttl { flex: 1; min-width: 0; }
.header .nm { font-size: 17px; font-weight: 700; line-height: 1.2; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.header .st { font-size: 12.5px; opacity: .85; margin-top: 2px; }
.header .av img { width: 100%; height: 100%; object-fit: contain; border-radius: 50%; }
.header .av.has-logo { background: #fff; padding: 4px; }
.header .logo { flex: none; max-width: 92px; max-height: 32px; object-fit: contain; }
.banner { position: relative; flex: none; background: #0001; }
.banner[hidden] { display: none; }
.bslide { display: none; height: 124px; }
.bslide.on { display: block; }
.bslide img, .bslide iframe { display: block; width: 100%; height: 100%; border: 0; object-fit: cover; }
.bdots { position: absolute; inset-inline: 0; bottom: 6px; display: flex; justify-content: center; gap: 5px; pointer-events: none; }
.bdots i { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,.55); }
.bdots i.on { background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.25); }
.bx { position: absolute; top: 6px; inset-inline-end: 6px; width: 24px; height: 24px; border: 0; border-radius: 50%; background: rgba(0,0,0,.45); color: #fff; display: grid; place-items: center; cursor: pointer; padding: 0; }
.pop { position: absolute; top: 58px; inset-inline-end: 10px; z-index: 6; width: min(320px, calc(100% - 20px)); max-height: 70%; overflow-y: auto; background: #fff; color: #20222e; border: 1px solid #e6e8f2; border-radius: 16px; padding: 8px; box-shadow: 0 14px 36px rgba(30,32,60,.24); display: flex; flex-direction: column; gap: 6px; }
.pop[hidden] { display: none; }
.pop.at-start { inset-inline-end: auto; inset-inline-start: 10px; }
.pop .mi { display: flex; align-items: center; gap: 10px; border: 0; background: transparent; text-align: start; font: inherit; font-size: 13.5px; font-weight: 600; padding: 8px 10px; border-radius: 10px; cursor: pointer; color: inherit; text-decoration: none; }
/* The cross asks before it ends the chat, then asks for a rating. */
.modal { position: fixed; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(32,34,46,.42); backdrop-filter: blur(3px); }
.modal[hidden] { display: none; }
.sheet { width: min(330px, 100%); max-height: 100%; overflow-y: auto; background: #fff; color: #20222e; border-radius: 22px; padding: 24px 20px 16px; text-align: center; box-shadow: 0 20px 50px rgba(30,32,60,.3); display: flex; flex-direction: column; align-items: center; }
.sheet .wi { width: 44px; height: 44px; border-radius: 50%; background: #fdeceb; color: #d24b43; display: grid; place-items: center; margin-bottom: 14px; }
.sheet .q { margin: 0 0 16px; font-weight: 600; font-size: 15.5px; line-height: 1.4; overflow-wrap: anywhere; }
.sheet button { width: 100%; min-height: 44px; border-radius: 12px; font: inherit; font-size: 14.5px; font-weight: 600; cursor: pointer; padding: 9px 12px; white-space: normal; overflow-wrap: anywhere; }
.sheet .danger { border: 0; background: #d64a41; color: #fff; }
.sheet .danger:hover { background: #bf3d35; }
.sheet .outline { margin-top: 8px; min-height: 42px; font-size: 14px; font-weight: 500; border: 1px solid #e3e5f0; background: #fff; color: #20222e; }
.sheet .outline:hover { background: #f6f7fc; }
.sheet .ghost { margin-top: 8px; min-height: 36px; font-size: 13px; font-weight: 500; border: 0; background: transparent; color: #6b7088; }
.sheet .accent { border: 0; background: var(--accent); color: var(--accent-ink); }
.sheet textarea { width: 100%; min-height: 84px; resize: none; border: 1px solid var(--accent); border-radius: 12px; padding: 10px 12px; font: inherit; font-size: 14px; margin-bottom: 14px; color: inherit; }
.stars { display: flex; gap: 6px; margin: 2px 0 6px; }
.sheet .stars button { width: 34px; min-height: 34px; padding: 0; border: 0; background: transparent; color: #d8dbe6; font-size: 30px; line-height: 1; }
.sheet .stars button.on { color: #f5a623; }
.rlabel { min-height: 18px; margin-bottom: 14px; font-size: 13px; font-weight: 600; color: var(--accent); }
.pop .mi:hover { background: var(--accent-soft); color: var(--accent); }
.pop .mi img { width: 34px; height: 34px; border-radius: 9px; object-fit: cover; flex: none; }
.pop.blocks { display: grid; grid-template-columns: 1fr 1fr; }
.pop.blocks .mi { flex-direction: column; text-align: center; border: 1px solid #eceef6; padding: 10px 6px; }
.pop.blocks .mi img { width: 100%; height: 64px; }
.nc { border: 1px solid #eceef6; border-radius: 14px; overflow: hidden; background: #fff; }
.nc img { display: block; width: 100%; max-height: 120px; object-fit: cover; }
.nc .nb { padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.nc .nt { font-weight: 700; font-size: 14px; }
.nc .nd { font-size: 12.5px; color: #5b5e75; }
.nc a.nbtn { align-self: flex-start; margin-top: 4px; padding: 7px 14px; border-radius: 999px; background: var(--accent); color: var(--accent-ink); font-weight: 700; font-size: 12.5px; text-decoration: none; }
.nc .nf { font-size: 11px; color: #8b8fa8; margin-top: 2px; }
.hx .dot { position: absolute; top: 4px; inset-inline-end: 4px; width: 8px; height: 8px; border-radius: 50%; background: #ff5a68; }
.hx { position: relative; }
.pipcard { margin: 0 14px 8px; padding: 10px 12px; border-radius: 14px; background: var(--accent-soft); border: 1px solid var(--accent-line); font-size: 12.5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: none; }
.pipcard[hidden] { display: none; }
.pipcard span { flex: 1 1 160px; }
.pipcard button { border: 0; border-radius: 999px; padding: 6px 13px; font: inherit; font-weight: 700; font-size: 12px; cursor: pointer; background: var(--accent); color: var(--accent-ink); }
.pipcard button.no { background: transparent; color: inherit; opacity: .75; }
.row.in.has-av { position: relative; padding-inline-start: 34px; }
.bav { position: absolute; inset-inline-start: 0; top: 0; width: 26px; height: 26px; border-radius: 50%; object-fit: cover; background: var(--accent-soft); }
body[data-corner="soft"] .bubble { border-radius: 12px 12px 12px 4px; }
body[data-corner="soft"] .bubble.out { border-radius: 12px 12px 4px 12px; }
body[data-corner="soft"] .card, body[data-corner="soft"] .input-row { border-radius: 12px; }
body[data-corner="square"] .bubble, body[data-corner="square"] .bubble.out, body[data-corner="square"] .card, body[data-corner="square"] .input-row, body[data-corner="square"] .typing { border-radius: 2px; }
.stage { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.body { flex: 1; min-height: 0; padding: 16px 14px 8px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; scroll-behavior: smooth; }
.body::-webkit-scrollbar { width: 8px; }
.body::-webkit-scrollbar-thumb { background: rgba(0,0,0,.18); border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }
.row { display: flex; flex-direction: column; gap: 4px; max-width: 88%; animation: rowIn .24s cubic-bezier(.2,.7,.3,1) both; }
.row.in { align-self: flex-start; align-items: flex-start; }
.row.out { align-self: flex-end; align-items: flex-end; }
.bubble { padding: 11px 15px; border-radius: 20px 20px 20px 6px; font-size: calc(var(--fs, 14px) + .5px); line-height: 1.45; word-wrap: break-word; overflow-wrap: anywhere; white-space: pre-wrap; box-shadow: 0 1px 3px rgba(30,32,60,.08); border: 1px solid rgba(30,32,60,.06); }
.bubble.out { border-radius: 20px 20px 6px 20px; background: var(--accent); color: var(--accent-ink); border-color: transparent; box-shadow: 0 2px 8px rgba(0,0,0,.14); }
.time { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #8b8fa8; padding: 0 4px; }
.row.out .time svg { color: var(--accent); }
.bubble code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .92em; background: rgba(30,32,60,.08); border-radius: 4px; padding: 0 3px; }
.bubble.media { padding: 5px; }
.bubble.media .cap { padding: 7px 10px 5px; white-space: pre-wrap; }
.bubble img.shot { display: block; max-width: 100%; max-height: 240px; border-radius: 15px; cursor: zoom-in; }
.bubble video { display: block; max-width: 100%; max-height: 240px; border-radius: 15px; background: #000; }
.bubble audio { display: block; width: 230px; max-width: 100%; }
.bubble a.doc { display: flex; align-items: center; gap: 11px; padding: 8px 10px; color: inherit; text-decoration: none; }
.bubble a.doc .ico { flex: none; width: 36px; height: 42px; border-radius: 8px; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; font-size: 10px; font-weight: 800; letter-spacing: .04em; }
.bubble a.doc .nm { min-width: 0; flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bubble a.doc .dl { flex: none; width: 32px; height: 32px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; }
.row.wide { max-width: 100%; align-self: stretch; }
.cards { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding: 0 14px; width: calc(100% + 28px); margin: 0 -14px; padding: 2px 14px 8px; scrollbar-width: thin; }
.card { flex: none; width: 214px; scroll-snap-align: start; display: flex; flex-direction: column; background: #fff; border: 1px solid rgba(30,32,60,.08); border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(30,32,60,.08); }
.card img { display: block; width: 100%; height: 112px; object-fit: cover; background: #eef0f6; }
.card .cb { flex: 1; display: flex; flex-direction: column; gap: 4px; padding: 12px 13px 8px; }
.card .ct { font-size: 14.5px; font-weight: 700; line-height: 1.25; color: #20222e; }
.card .tx { font-size: 13px; line-height: 1.4; color: #5b5e75; white-space: pre-wrap; overflow-wrap: anywhere; }
.card .bt { display: flex; flex-direction: column; gap: 7px; padding: 4px 13px 13px; }
.card .bt .chip { justify-content: center; width: 100%; }
.links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
a.chip { text-decoration: none; }
.chip { border-radius: var(--r, 999px); }
.chip .ico { border-radius: var(--rb, 50%); }
body[data-icons="off"] .chip .ico:not(.pic) { display: none; }
.chip .ico.pic { background: transparent; overflow: hidden; }
.chip.menu.picked { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.chip .ico img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; display: block; }
.chip .lico { width: 18px; height: 18px; border-radius: 5px; object-fit: cover; }
body[data-icons="off"] .chip.menu { padding: 8px 15px; }
body[data-fill="tinted"] .chip { background: var(--accent-soft); border-color: var(--accent-line); }
body[data-fill="solid"] .chip { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
body[data-fill="solid"] .chip:hover { opacity: .92; }
body[data-fill="solid"] .chip .ico { background: rgba(255,255,255,.22); color: var(--accent-ink); }
.sugg { display: flex; gap: 7px; padding: 10px 14px 0; overflow-x: auto; flex: none; background: #fff; scrollbar-width: none; }
.sugg::-webkit-scrollbar { display: none; }
.sugg[hidden] { display: none; }
.sugg .chip { flex: none; white-space: nowrap; padding: 7px 13px; font-size: 13px; }
.acts { display: inline-flex; gap: 2px; margin-inline-start: 6px; }
.act { width: 24px; height: 24px; border: 0; border-radius: 6px; background: transparent; color: #8b8fa8; display: grid; place-items: center; cursor: pointer; padding: 0; }
.act:hover { background: rgba(0,0,0,.06); color: var(--accent); }
.act[aria-pressed="true"] { color: var(--accent); }
.act.down svg { transform: rotate(180deg); }
.fbmsg { font-size: 11.5px; color: #8b8fa8; align-self: center; margin-inline-start: 6px; }
.input-row .mic, .mic { flex: none; width: 36px; height: 36px; padding: 0; gap: 0; border: 0; border-radius: 12px; background: transparent; color: #8b8fa8; display: grid; place-items: center; cursor: pointer; padding: 0; }
.mic:hover { color: var(--accent); background: var(--accent-soft); }
.mic[hidden] { display: none; }
.voice { position: absolute; inset: 0; z-index: 4; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 24px; text-align: center; color: #fff; background: linear-gradient(180deg, var(--accent), #14162a 85%); }
.voice[hidden] { display: none; }
.orb { position: relative; width: 120px; height: 120px; display: grid; place-items: center; }
.orb i { position: absolute; inset: 14px; border-radius: 50%; background: radial-gradient(circle at 32% 28%, rgba(255,255,255,.7), var(--accent) 62%, #14162a); animation: orb 2.6s ease-in-out infinite; box-shadow: 0 0 44px var(--accent); }
.orb b { position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(255,255,255,.5); animation: ring 2.2s ease-out infinite; }
@keyframes orb { 0%, 100% { transform: scale(1); opacity: .9; } 50% { transform: scale(1.06); opacity: 1; } }
@keyframes ring { 0% { transform: scale(1); opacity: .45; } 100% { transform: scale(1.75); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .orb i, .orb b { animation: none !important; } }
.vphase { font-size: 12.5px; letter-spacing: .1em; text-transform: uppercase; font-weight: 700; opacity: .75; }
.vline { font-size: 17px; font-weight: 600; line-height: 1.35; max-width: 300px; min-height: 46px; overflow-wrap: anywhere; }
.vbtns { display: flex; gap: 8px; }
.vbtns button { border: 0; border-radius: 999px; padding: 9px 16px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; background: rgba(255,255,255,.18); color: #fff; }
.vbtns button.end { background: #ff5a68; }
.chips { align-self: flex-start; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; max-width: 94%; padding: 2px 2px 6px; animation: rowIn .24s cubic-bezier(.2,.7,.3,1) both; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 8px 15px; border-radius: 999px; border: 1.5px solid var(--accent-line); background: #fff; color: var(--accent); font: inherit; font-size: 13.5px; font-weight: 600; line-height: 1.25; text-align: left; cursor: pointer; transition: background .15s, border-color .15s; }
.chip.menu { padding: 5px 16px 5px 5px; gap: 10px; }
.chip .ico { flex: none; width: 28px; height: 28px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; }
.chip:hover { background: var(--hover, var(--accent-soft)); border-color: var(--accent); }
.chip:focus-visible, .att:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.chip:disabled { opacity: .5; cursor: default; }
.typing { align-self: flex-start; display: flex; align-items: center; gap: 5px; padding: 14px 16px; background: #fff; border: 1px solid rgba(30,32,60,.06); border-radius: 20px 20px 20px 6px; box-shadow: 0 1px 3px rgba(30,32,60,.08); }
.typing i { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: dot 1.1s infinite; }
.typing i:nth-child(2) { animation-delay: .16s; }
.typing i:nth-child(3) { animation-delay: .32s; }
.latest { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); display: none; align-items: center; gap: 6px; padding: 7px 13px; border: 1px solid #e6e8f2; border-radius: 999px; background: #fff; color: var(--accent); font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(30,32,60,.16); }
.intake { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 14px; padding: 12px; margin-bottom: 10px; }
.intake .title { font-size: 13px; color: #1f2937; margin-bottom: 8px; font-weight: 700; }
.intake label { display: block; font-size: 11.5px; color: #6b7280; margin-bottom: 4px; }
.intake input { width: 100%; padding: 9px 11px; border: 1px solid #d9dce8; border-radius: 10px; font: inherit; font-size: 13.5px; margin-bottom: 8px; outline: none; }
.intake input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.intake label.consent { display: flex; gap: 8px; align-items: flex-start; font-size: 11.5px; color: #374151; margin: 2px 0 10px; line-height: 1.4; }
.intake label.consent input { width: auto; margin: 2px 0 0; padding: 0; flex: none; }
.intake label.consent a { color: var(--accent); }
.intake .age-err { color: #b91c1c; font-size: 12px; margin: -2px 0 8px; }
.intake button { width: 100%; padding: 10px; background: var(--accent); color: var(--accent-ink); border: 0; border-radius: 12px; font: inherit; font-weight: 700; font-size: 13.5px; cursor: pointer; }
.footer { padding: 12px 14px 10px; border-top: 1px solid #f0f1f7; background: #fff; flex: none; position: relative; }
.dpbtn { flex: none; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 10px; background: transparent; color: var(--accent); display: grid; place-items: center; cursor: pointer; }
.dpbtn svg { flex: none; width: 19px; height: 19px; }
.dpbtn[hidden] { display: none; }
.dpbtn:hover { background: var(--accent-soft); }
.dp { position: absolute; left: 12px; right: 12px; bottom: calc(100% + 6px); z-index: 30; background: #fff; color: #222; border: 1px solid #e6e8f2; border-radius: 16px; box-shadow: 0 14px 40px rgba(30, 28, 70, .18); padding: 12px; max-width: 340px; margin: 0 auto; max-height: calc(100vh - 140px); overflow-y: auto; }
.dp[hidden] { display: none; }
.dp .dphead { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.dp .dpnav { width: 30px; height: 30px; border: 1px solid #e3e5f0; border-radius: 9px; background: #fff; color: #444; display: grid; place-items: center; cursor: pointer; padding: 0; }
.dp .dpnav:hover { background: var(--accent-soft); border-color: var(--accent-line); }
.dp .dptitle { font-weight: 700; font-size: 14px; text-transform: capitalize; }
.dp .dpgrid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; }
.dp .dpwd { font-size: 10.5px; font-weight: 600; color: #8b8fa8; padding: 4px 0; text-transform: uppercase; }
.dp .dpday { position: relative; height: 34px; border: 0; border-radius: 10px; background: transparent; font: inherit; font-size: 13.5px; color: #222; cursor: pointer; padding: 0; }
.dp .dpday:hover { background: var(--accent-soft); }
.dp .dpday.out { color: #b4b7cc; }
.dp .dpday.today::after { content: ""; position: absolute; left: 50%; bottom: 4px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: var(--accent); }
.dp .dpday.sel { background: var(--accent); color: var(--accent-ink); font-weight: 700; }
.dp .dpday.sel::after { background: var(--accent-ink); }
.dp .dpfoot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #eef0f7; font-size: 13px; }
.dp .dpsel { color: #6b6f88; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp .dpgo { border: 0; border-radius: 10px; background: var(--accent); color: var(--accent-ink); font: inherit; font-weight: 600; font-size: 13px; padding: 7px 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.dp .dpgo:disabled { opacity: .45; cursor: default; }
.dp .dplink { border: 0; background: transparent; color: var(--accent); font: inherit; font-weight: 600; font-size: 13px; cursor: pointer; padding: 6px 4px; }
.dp .dptime { display: flex; align-items: center; gap: 14px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #eef0f7; }
.dp .dpclock { flex: none; width: 104px; height: 104px; }
.dp .dpcols { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.dp .dplab { font-size: 10.5px; font-weight: 700; color: #8b8fa8; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }
.dp .dpnums { display: grid; grid-template-columns: repeat(6, 1fr); gap: 2px; }
.dp .dpnum { height: 26px; border: 0; border-radius: 8px; background: transparent; font: inherit; font-size: 12px; color: #333; cursor: pointer; padding: 0; }
.dp .dpnum:hover { background: var(--accent-soft); }
.dp .dpnum.sel { background: var(--accent); color: var(--accent-ink); font-weight: 700; }
.dp .dpmin { display: flex; align-items: center; gap: 6px; }
.dp .dpmin input { width: 52px; border: 1px solid #e3e5f0; border-radius: 8px; padding: 5px 6px; font: inherit; font-size: 13px; text-align: center; }

.input-row { display: flex; align-items: center; gap: 8px; background: #f4f4fb; border: 1px solid #eceef6; border-radius: 18px; padding: 5px 5px 5px 15px; transition: border-color .15s, box-shadow .15s; }
.input-row:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.input-row .cc { flex: none; width: 92px; max-width: 34%; border: 0; border-inline-end: 1px solid #dfe2ee; border-radius: 0; background: transparent; font: inherit; font-size: 13.5px; font-weight: 600; color: #2c2e3d; padding: 8px 4px 8px 0; text-overflow: ellipsis; cursor: pointer; outline: none; }
.input-row .cc[hidden] { display: none; }
.input-row .locbtn { display: none; flex: 1; justify-content: center; }
.input-row.loc { padding: 5px; }
.input-row.loc #txt, .input-row.loc #send, .input-row.loc .cc { display: none; }
.input-row.loc .locbtn { display: inline-flex; background: var(--accent); color: var(--accent-ink); }
.input-row.loc + .hint { display: none; }
.input-row input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; font: inherit; font-size: 14.5px; padding: 9px 0; color: #2c2e3d; }
.input-row button { display: inline-flex; align-items: center; gap: 7px; flex: none; height: 38px; padding: 0 16px; border: 0; border-radius: 14px; font: inherit; font-weight: 700; font-size: 13px; cursor: pointer; }
.input-row button:disabled { opacity: .5; cursor: not-allowed; }
.input-row #send { width: 40px; height: 40px; padding: 0; justify-content: center; border-radius: 12px; background: var(--accent); color: var(--accent-ink); border: 1.5px solid var(--accent); transition: background .15s, color .15s; }
.input-row #send.empty { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-line); }
body[data-preview] .input-row #send:disabled { opacity: 1; cursor: default; }
.hint { margin-top: 8px; padding-left: 4px; font-size: 11.5px; color: #a3a7bd; }
.wa-cta { margin-top: 10px; display: block; text-align: center; padding: 9px 12px; border-radius: 12px; background: #25D366; color: #fff; font-weight: 700; font-size: 13px; text-decoration: none; }
.att { flex: 1; display: none; align-items: center; justify-content: center; gap: 8px; padding: 10px 14px; border: 1.5px dashed var(--accent-line); border-radius: 14px; background: #fff; color: var(--accent); font-size: 13.5px; font-weight: 700; cursor: pointer; }
.att:hover { border-color: var(--accent); background: var(--accent-soft); }
.att.busy { opacity: .6; pointer-events: none; }
.input-row.file + .hint { display: none; }
.input-row.file { padding: 5px; }
.input-row.file .att { display: flex; }
.input-row.file #txt, .input-row.file #send { display: none; }
`;

/** The page script. It is a plain string so it can be inlined; it must not contain a backtick or a template placeholder. */
const SCRIPT = `
(function () {
  var TOKEN = __TOKEN__;
  var FLOW = __FLOW__;
  var PREVIEW = __PREVIEW__;
  var T = __TEXT__;
  var COUNTRIES = __COUNTRIES__;
  var SIZES = __SIZES__;
  // The window's own words, in the visitor's language (English is the fallback for a missing key).
  function tx(key, fallback) { return (T && T[key]) || fallback; }
  var VKEY = 'wsnap_vid_' + TOKEN;
  var BASE = '/widget/' + TOKEN + '/api/';
  var API_CFG = BASE + 'config';
  var API_MSG = BASE + 'message';
  var API_HIS = BASE + 'history';
  var API_UP = BASE + 'upload';
  var API_FB = BASE + 'feedback';
  var API_RATE = BASE + 'rating';
  var API_LOC = BASE + 'location';

  // The visitor id lives in the iframe's own localStorage, not only in a cookie: the page runs in a cross-site frame where
  // third-party cookies are often blocked, and without it every visit would start a new conversation.
  // QUIRK: reproduced deliberately (TW-WGT-023 rule 2). The key is built from the TOKEN, so rotating the token orphans a
  // returning visitor whose cookie is blocked: they get a new visitor and a new conversation.
  function storedUuid() { try { return localStorage.getItem(VKEY) || ''; } catch (e) { return ''; } }
  function storeUuid(u) { try { if (u) localStorage.setItem(VKEY, u); } catch (e) {} }
  function withVid(url) {
    var u = storedUuid();
    return u ? url + (url.indexOf('?') >= 0 ? '&' : '?') + 'visitor_uuid=' + encodeURIComponent(u) : url;
  }

  var cfg = null;
  var lastSeenMsgId = 0;
  var intakeDone = false;
  function $(id) { return document.getElementById(id); }

  // What the newest bot question waits for: the keyboard, a date picker or an attach button. It follows the newest bot line, so a
  // retry after a wrong answer (which carries the same input) keeps it.
  var hint = null;
  // A date or date-time answer is typed in the question's own shape (a native date picker would show the browser's shape instead).
  function dateShape(h) {
    if (h && h.type === 'time') return 'HH:MM';
    var f = String((h && h.format) || 'dd-mm-yyyy').toUpperCase();
    return h && h.type === 'datetime' ? f + ' HH:MM' : f;
  }
  // A phone question shows a country list beside the box; the number goes out as +<code> <number>, so it is judged by that country's rules.
  function flagOf(code) {
    return code.length === 2 ? String.fromCodePoint(127397 + code.charCodeAt(0), 127397 + code.charCodeAt(1)) : '';
  }
  var ccPicked = '';
  function paintCountries(h) {
    var cc = $('cc');
    if (!cc.options.length) {
      COUNTRIES.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.dial;
        o.dataset.code = c.code;
        o.textContent = '+' + c.dial + ' ' + flagOf(c.code) + ' ' + c.name;
        cc.appendChild(o);
      });
      cc.setAttribute('aria-label', tx('countryCode', 'Country code'));
      cc.addEventListener('change', function () { ccPicked = cc.options[cc.selectedIndex].dataset.code || ''; });
    }
    // The visitor's own pick wins over the default, so a wrong answer (the question is asked again) does not reset the list.
    // Until the visitor picks one, India (or the country the question names).
    var want = ccPicked || String((h && h.country) || 'IN').toUpperCase();
    for (var i = 0; i < cc.options.length; i++) if (cc.options[i].dataset.code === want) { cc.selectedIndex = i; return; }
  }
  // A date, date-and-time or time question opens a calendar (and a clock) above the box; the pick is written into the box in the question's own
  // shape, so the answer is judged exactly as if it had been typed.
  var LOC = document.documentElement.lang || navigator.language || 'en';
  var dp = { m: 0, y: 0, sel: null, h: 12, mi: 0 };
  function dpPad(n) { return (n < 10 ? '0' : '') + n; }
  function dpType() { return hint && (hint.type === 'date' || hint.type === 'datetime' || hint.type === 'time') ? hint.type : null; }
  function dpDateText(d) {
    var f = String((hint && hint.format) || 'dd-mm-yyyy').toLowerCase();
    return f.replace('yyyy', String(d.y)).replace('yy', String(d.y).slice(-2)).replace('dd', dpPad(d.d)).replace('mm', dpPad(d.m + 1));
  }
  function dpValue() {
    var type = dpType();
    var time = dpPad(dp.h) + ':' + dpPad(dp.mi);
    if (type === 'time') return time;
    if (!dp.sel) return '';
    return type === 'datetime' ? dpDateText(dp.sel) + ' ' + time : dpDateText(dp.sel);
  }
  function dpSvg(path) { var s = svg(14, [path]); s.setAttribute('stroke-width', '2.2'); s.setAttribute('aria-hidden', 'true'); return s; }
  function dpEl(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function dpClose() { $('dp').hidden = true; $('dpbtn').setAttribute('aria-expanded', 'false'); }
  function dpFill() {
    var v = dpValue();
    if (!v) return;
    var t = $('txt'); t.value = v; syncSend(); dpClose(); t.focus();
  }
  function dpClock() {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('class', 'dpclock'); svg.setAttribute('aria-hidden', 'true');
    function add(name, attrs) { var n = document.createElementNS(NS, name); for (var k in attrs) n.setAttribute(k, attrs[k]); svg.appendChild(n); return n; }
    add('circle', { cx: 50, cy: 50, r: 47, fill: '#fff', stroke: 'var(--accent-line)', 'stroke-width': 3 });
    for (var i = 0; i < 12; i++) {
      var a = i * Math.PI / 6, big = i % 3 === 0;
      add('line', { x1: 50 + Math.sin(a) * (big ? 36 : 40), y1: 50 - Math.cos(a) * (big ? 36 : 40), x2: 50 + Math.sin(a) * 44, y2: 50 - Math.cos(a) * 44, stroke: big ? 'var(--accent)' : '#b4b7cc', 'stroke-width': big ? 2.6 : 1.6, 'stroke-linecap': 'round' });
    }
    var ha = ((dp.h % 12) + dp.mi / 60) * Math.PI / 6, ma = dp.mi * Math.PI / 30;
    add('line', { x1: 50, y1: 50, x2: 50 + Math.sin(ha) * 22, y2: 50 - Math.cos(ha) * 22, stroke: '#222', 'stroke-width': 4, 'stroke-linecap': 'round' });
    add('line', { x1: 50, y1: 50, x2: 50 + Math.sin(ma) * 33, y2: 50 - Math.cos(ma) * 33, stroke: 'var(--accent)', 'stroke-width': 2.8, 'stroke-linecap': 'round' });
    add('circle', { cx: 50, cy: 50, r: 3.6, fill: 'var(--accent)' });
    return svg;
  }
  function dpRender() {
    var type = dpType();
    var box = $('dp');
    if (!type) { dpClose(); return; }
    box.textContent = '';
    if (type !== 'time') {
      var head = dpEl('div', 'dphead');
      var prev = dpEl('button', 'dpnav'); prev.type = 'button'; prev.appendChild(dpSvg('M15 6l-6 6 6 6')); prev.setAttribute('aria-label', 'Previous month');
      var next = dpEl('button', 'dpnav'); next.type = 'button'; next.appendChild(dpSvg('M9 6l6 6-6 6')); next.setAttribute('aria-label', 'Next month');
      var first = new Date(dp.y, dp.m, 1);
      var title = dpEl('div', 'dptitle', new Intl.DateTimeFormat(LOC, { month: 'long', year: 'numeric' }).format(first));
      prev.addEventListener('click', function () { dp.m -= 1; if (dp.m < 0) { dp.m = 11; dp.y -= 1; } dpRender(); });
      next.addEventListener('click', function () { dp.m += 1; if (dp.m > 11) { dp.m = 0; dp.y += 1; } dpRender(); });
      head.appendChild(prev); head.appendChild(title); head.appendChild(next); box.appendChild(head);
      var grid = dpEl('div', 'dpgrid');
      var wd = new Intl.DateTimeFormat(LOC, { weekday: 'short' });
      for (var w = 0; w < 7; w++) grid.appendChild(dpEl('div', 'dpwd', wd.format(new Date(2023, 0, 1 + w)).slice(0, 2)));
      var today = new Date();
      var start = new Date(dp.y, dp.m, 1 - first.getDay());
      for (var c = 0; c < 42; c++) {
        var day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + c);
        var b = dpEl('button', 'dpday', String(day.getDate())); b.type = 'button';
        if (day.getMonth() !== dp.m) b.classList.add('out');
        if (day.getFullYear() === today.getFullYear() && day.getMonth() === today.getMonth() && day.getDate() === today.getDate()) b.classList.add('today');
        if (dp.sel && dp.sel.y === day.getFullYear() && dp.sel.m === day.getMonth() && dp.sel.d === day.getDate()) b.classList.add('sel');
        b.addEventListener('click', (function (dd) { return function () {
          dp.sel = { y: dd.getFullYear(), m: dd.getMonth(), d: dd.getDate() };
          dp.y = dd.getFullYear(); dp.m = dd.getMonth();
          if (type === 'date') dpFill(); else dpRender();
        }; })(day));
        grid.appendChild(b);
      }
      box.appendChild(grid);
    }
    if (type !== 'date') {
      var tm = dpEl('div', 'dptime');
      tm.appendChild(dpClock());
      var cols = dpEl('div', 'dpcols');
      var hl = dpEl('div'); hl.appendChild(dpEl('div', 'dplab', 'Hour'));
      var hn = dpEl('div', 'dpnums');
      for (var h = 0; h < 24; h++) {
        var hb = dpEl('button', 'dpnum' + (dp.h === h ? ' sel' : ''), dpPad(h)); hb.type = 'button';
        hb.addEventListener('click', (function (v) { return function () { dp.h = v; dpRender(); }; })(h));
        hn.appendChild(hb);
      }
      hl.appendChild(hn); cols.appendChild(hl);
      var ml = dpEl('div'); ml.appendChild(dpEl('div', 'dplab', 'Minute'));
      var mrow = dpEl('div', 'dpmin');
      var mi = document.createElement('input'); mi.type = 'number'; mi.min = 0; mi.max = 59; mi.value = dpPad(dp.mi); mi.setAttribute('aria-label', 'Minute');
      mi.addEventListener('change', function () { var v = Math.max(0, Math.min(59, parseInt(mi.value, 10) || 0)); dp.mi = v; dpRender(); });
      mrow.appendChild(mi);
      [0, 15, 30, 45].forEach(function (v) {
        var q = dpEl('button', 'dpnum' + (dp.mi === v ? ' sel' : ''), dpPad(v)); q.type = 'button'; q.style.width = '34px';
        q.addEventListener('click', function () { dp.mi = v; dpRender(); });
        mrow.appendChild(q);
      });
      ml.appendChild(mrow); cols.appendChild(ml); tm.appendChild(cols); box.appendChild(tm);
    }
    var foot = dpEl('div', 'dpfoot');
    var left = dpEl('div', 'dpsel');
    if (type === 'date') {
      var tb = dpEl('button', 'dplink', new Intl.RelativeTimeFormat(LOC, { numeric: 'auto' }).format(0, 'day')); tb.type = 'button'; tb.style.textTransform = 'capitalize';
      tb.addEventListener('click', function () { var n = new Date(); dp.sel = { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() }; dpFill(); });
      left.appendChild(tb);
    } else left.textContent = dpValue() || '—';
    foot.appendChild(left);
    if (type !== 'date') {
      var go = dpEl('button', 'dpgo'); go.type = 'button'; go.appendChild(dpSvg('M5 12.5l4.5 4.5L19 7.5')); go.appendChild(dpEl('span', '', tx('continue', 'Continue')));
      go.disabled = type === 'datetime' && !dp.sel;
      go.addEventListener('click', dpFill);
      foot.appendChild(go);
    }
    box.appendChild(foot);
    box.hidden = false; $('dpbtn').setAttribute('aria-expanded', 'true');
  }
  function dpOpen() {
    if (!dpType() || PREVIEW) return;
    var n = new Date();
    if (!dp.sel) { dp.y = n.getFullYear(); dp.m = n.getMonth(); }
    if (dpType() === 'time' || !dp.sel) { dp.h = n.getHours(); dp.mi = Math.round(n.getMinutes() / 5) * 5 % 60; }
    dpRender();
  }
  $('dpbtn').addEventListener('click', function () { if ($('dp').hidden) dpOpen(); else dpClose(); });
  $('txt').addEventListener('focus', function () { if (dpType() && $('dp').hidden && !$('txt').value) dpOpen(); });
  document.addEventListener('click', function (e) { var box = $('dp'); if (!box.hidden && !box.contains(e.target) && e.target !== $('txt') && !$('dpbtn').contains(e.target)) dpClose(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') dpClose(); });
  function setHint(h) {
    hint = h && h.type && h.type !== 'text' && h.type !== 'alphanumeric' ? h : null;
    var t = $('txt'), row = document.querySelector('.input-row'), type = hint ? hint.type : 'text';
    t.value = ''; syncSend();
    var ccBox = $('cc');
    ccBox.hidden = type !== 'phone';
    if (type === 'phone') paintCountries(hint);
    t.type = type === 'email' ? 'email' : type === 'phone' ? 'tel' : 'text';
    if (type === 'number') t.setAttribute('inputmode', 'decimal');
    else if (type === 'phone') t.setAttribute('inputmode', 'tel');
    else if (type === 'email') t.setAttribute('inputmode', 'email');
    else t.removeAttribute('inputmode');
    t.setAttribute('autocomplete', type === 'name' ? 'name' : type === 'email' ? 'email' : type === 'phone' ? 'tel' : 'off');
    t.placeholder = type === 'name' ? tx('yourName', 'Your name') : type === 'email' ? tx('emailPh', 'name@example.com') : type === 'phone' ? tx('phonePh', 'Phone number') : type === 'number' ? tx('numberPh', 'A number') : type === 'date' || type === 'datetime' || type === 'time' ? dateShape(hint) : tx('typeMessage', 'Type a message\\u2026');
    row.className = 'input-row' + (type === 'file' ? ' file' : type === 'location' ? ' loc' : '');
    dp.sel = null;
    $('dpbtn').hidden = !dpType();
    if (dpType()) dpOpen(); else dpClose();
    $('locbtn').textContent = '\\uD83D\\uDCCD ' + tx('shareLocation', 'Share my location');
    var f = $('file');
    f.accept = type === 'file' && hint.accept && hint.accept.length ? hint.accept.map(function (e) { return '.' + e; }).join(',') : '';
  }

  // How the window looks and behaves beyond its colours (the author's settings): reply button fill and shape, typeface, suggestions,
  // the copy / like icons, the expand button and the voice conversation.
  var CHAT = { fill: 'outline', shape: 'pill', font: 'system', size: 'standard', header: 'diagonal', direction: 'auto', icons: true, suggestions: [], suggestionNodes: [], suggestionsOn: true, actions: true, expand: true, voice: false, logo: '', avatar: '', background: '', corner: 'rounded', autoOpen: 0, sound: false, notice: { enabled: false, icon: 1, items: [] }, quickMenu: { enabled: false, view: 'list', items: [] }, banners: { enabled: false, items: [] }, fontSize: 14, hoverBg: '', soundVolume: 70, speak: false, pip: false, feedback: { enabled: true, message: '' } };
  var FONTS = {
    system: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
    serif: 'Georgia,"Times New Roman",serif',
    rounded: 'ui-rounded,"SF Pro Rounded","Hiragino Maru Gothic ProN",Quicksand,system-ui,sans-serif',
    humanist: 'Seravek,"Gill Sans Nova",Ubuntu,Calibri,"DejaVu Sans",sans-serif',
    mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'
  };
  var RADII = { pill: '999px', rounded: '12px', soft: '6px', square: '0px' };
  var visitorSpoke = false;
  var settled = false;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // The header's fill: the author's colour flat, or a gradient from it (the same five as the mock: solid, diagonal, vivid, dusk, soft).
  function headerFill(hb) {
    if (!hexRgb(hb) || CHAT.header === 'solid') return hb;
    if (CHAT.header === 'vivid') return 'linear-gradient(120deg,' + mix(hb, '#FFFFFF', 0.25) + ',' + hb + ' 55%,' + mix(hb, '#000000', 0.3) + ')';
    if (CHAT.header === 'dusk') return 'linear-gradient(135deg,' + mix(hb, '#000000', 0.18) + ',#1c1f3a)';
    if (CHAT.header === 'soft') return 'linear-gradient(100deg,' + hb + ' 0%,' + hb + ' 45%,' + mix(hb, '#FFFFFF', 0.3) + ' 100%)';
    return 'linear-gradient(115deg,' + hb + ',' + mix(hb, '#000000', 0.22) + ')';
  }

  function applyOptions() {
    var lc = (cfg && cfg.launcher && cfg.launcher.chat) || {};
    Object.keys(CHAT).forEach(function (k) { if (lc[k] !== undefined) CHAT[k] = lc[k]; });
    document.body.dataset.fill = CHAT.fill;
    document.body.dataset.icons = CHAT.icons === false ? 'off' : 'on';
    document.body.dataset.corner = CHAT.corner || 'rounded';
    document.body.style.setProperty('--fs', (Number(CHAT.fontSize) || 14) + 'px');
    if (/^#[0-9a-fA-F]{3,6}$/.test(CHAT.hoverBg || '')) document.body.style.setProperty('--hover', CHAT.hoverBg); else document.body.style.removeProperty('--hover');
    if (CHAT.direction === 'rtl' || CHAT.direction === 'ltr') document.documentElement.dir = CHAT.direction;
    document.body.style.setProperty('--r', RADII[CHAT.shape] || RADII.pill);
    document.body.style.setProperty('--rb', CHAT.shape === 'pill' ? '50%' : CHAT.shape === 'square' ? '0' : '8px');
    document.body.style.fontFamily = FONTS[CHAT.font] || FONTS.system;
    $('mic').hidden = !(CHAT.voice && SR && window.speechSynthesis);
  }

  // An image address is used only when it is an http(s) one (it comes from the author's upload, checked again here).
  function imgUrl(v) {
    // No address is no picture: an empty value would resolve against this page and draw a broken image (on a link button, an avatar).
    if (!String(v || '').trim()) return '';
    try {
      var u = new URL(String(v), window.location.href);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
    } catch (e) { return ''; }
  }
  var audioCtx = null;
  function blip() {
    if (!CHAT.sound || PREVIEW) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.3 * (Number(CHAT.soundVolume) || 0) / 100), audioCtx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.27);
    } catch (e) {}
  }
  // A tap tied to a step of the bot: the id the server turns into "start the bot at that step".
  function jumpId(node) { return cfg && cfg.flow_uuid && /^[\\w-]{1,64}$/.test(String(node || '')) ? 'go:' + cfg.flow_uuid + ':' + node : ''; }
  // The floating window (see the embed script): the page tells us whether the browser can, and whether it is open now.
  var PIPSTATE = { supported: false, active: false };
  var pipBtn = null;
  function toParent(m) { if (window.parent !== window) { try { window.parent.postMessage(m, '*'); } catch (e) {} } }
  function pipCard(text, buttons) {
    var box = $('pipcard');
    box.textContent = '';
    var sp = document.createElement('span');
    sp.textContent = text;
    box.appendChild(sp);
    buttons.forEach(function (b) {
      var el = document.createElement('button');
      el.type = 'button';
      if (b.no) el.className = 'no';
      el.textContent = b.label;
      el.onclick = function () { box.hidden = true; if (b.run) b.run(); };
      box.appendChild(el);
    });
    box.hidden = false;
  }
  // The float button of the header: shown only when the author turned it on and the browser can do it.
  function ensurePipButton() {
    var hdr = $('hdr');
    if (pipBtn && pipBtn.parentNode) pipBtn.remove();
    pipBtn = null;
    if (!FLOW || window.parent === window || !CHAT.pip || !PIPSTATE.supported) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'hx';
    var label = PIPSTATE.active ? tx('pipBack', 'Back to the page') : tx('pipFloat', 'Float the chat');
    b.setAttribute('aria-label', label);
    b.title = label;
    b.appendChild(svg(18, ['M3 5h18v14H3z', 'M12 12h7v5h-7z']));
    b.onclick = function () { toParent({ wgt: 'pip' }); };
    var first = hdr.querySelector('[data-end]');
    if (first) hdr.insertBefore(b, first); else hdr.appendChild(b);
    pipBtn = b;
  }
  // A flow bot opens by itself: the first time the window is open on an empty thread the bot starts at its first step, and does not
  // wait for the visitor to write. The site's panel tells the page when it is opened (a page of its own is open from the start).
  var windowOpened = window.parent === window, botReady = false, botStarted = false;
  function startBot() {
    if (!FLOW || PREVIEW || !botReady || !windowOpened || botStarted) return;
    botStarted = true;
    fetch(withVid(BASE + 'start'), { method: 'POST', credentials: 'include' })
      .then(function () { showTyping(); burstPoll(); })
      .catch(function () {});
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || e.source !== window.parent) return;
    if (d.wgt === 'opened') { windowOpened = true; startBot(); }
    else if (d.wgt === 'pip-state') { PIPSTATE = { supported: d.supported === true, active: d.active === true }; ensurePipButton(); }
    else if (d.wgt === 'pip-ask' && CHAT.pip) pipCard(tx('pipAsk', 'Keep chatting in a floating window when you switch tabs?'), [{ label: tx('pipAllow', 'Allow'), run: function () { toParent({ wgt: 'ask-notify' }); } }, { label: tx('pipNo', 'Not now'), no: true }]);
    else if (d.wgt === 'pip-offer' && CHAT.pip) pipCard(tx('pipOffer', 'Continue chatting in a floating window?'), [{ label: tx('pipYes', 'Float the chat'), run: function () { toParent({ wgt: 'pip' }); } }, { label: tx('pipNo', 'Not now'), no: true }]);
  });
  // A page a button opens: only http(s), phone and email addresses, checked again here.
  function safeAction(u) { return /^(https?:[/][/]|tel:|mailto:)/i.test(String(u || '')) ? String(u) : ''; }
  function openAction(u) {
    var url = safeAction(u);
    if (!url) return;
    if (/^https?:/i.test(url)) window.open(url, '_blank', 'noopener,noreferrer'); else window.location.href = url;
  }
  function safeVideo(u) { return /^https:[/][/](www[.]youtube(-nocookie)?[.]com[/]embed[/]|player[.]vimeo[.]com[/]video[/])/i.test(String(u || '')) ? String(u) : ''; }

  // The banner: pictures and videos above the conversation, one at a time, moving on by itself while no video is showing.
  var bannerClosed = false, bannerTimer = null;
  function paintBanner() {
    var box = $('banner');
    if (bannerTimer) { clearInterval(bannerTimer); bannerTimer = null; }
    box.textContent = '';
    var cfg0 = CHAT.banners || {};
    var items = (cfg0.items || []).filter(function (it) { return it.kind === 'video' ? safeVideo(it.video) : imgUrl(it.image); });
    if (!cfg0.enabled || !items.length || bannerClosed) { box.hidden = true; return; }
    var slides = [];
    var dots = document.createElement('div');
    dots.className = 'bdots';
    items.forEach(function (it, i) {
      var sl = document.createElement('div');
      sl.className = 'bslide' + (i === 0 ? ' on' : '');
      if (it.kind === 'video') {
        var f = document.createElement('iframe');
        f.src = safeVideo(it.video);
        f.title = tx('banner', 'Banner');
        f.setAttribute('allow', 'encrypted-media; picture-in-picture; fullscreen');
        f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
        f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        sl.appendChild(f);
      } else {
        var im = document.createElement('img');
        im.src = imgUrl(it.image); im.alt = '';
        var bjump = jumpId(it.node);
        if (safeAction(it.url)) { im.style.cursor = 'pointer'; im.onclick = function () { openAction(it.url); }; }
        else if (bjump) { im.style.cursor = 'pointer'; im.onclick = function () { send(tx('banner', 'Banner'), bjump); }; }
        sl.appendChild(im);
      }
      slides.push(sl); box.appendChild(sl);
      dots.appendChild(document.createElement('i'));
    });
    var at = 0;
    function show(n) {
      at = n;
      slides.forEach(function (x, i) { x.classList.toggle('on', i === n); });
      [].forEach.call(dots.children, function (d, i) { d.classList.toggle('on', i === n); });
    }
    show(0);
    if (items.length > 1) {
      box.appendChild(dots);
      if (!items.some(function (it) { return it.kind === 'video'; })) bannerTimer = setInterval(function () { show((at + 1) % slides.length); }, 5000);
    }
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'bx';
    x.setAttribute('aria-label', tx('dismiss', 'Dismiss'));
    x.appendChild(svg(12, ['M6 6l12 12', 'M18 6L6 18']));
    x.onclick = function () { bannerClosed = true; box.hidden = true; if (bannerTimer) clearInterval(bannerTimer); box.textContent = ''; };
    box.appendChild(x);
    box.hidden = false;
  }

  var popsBound = false;
  function closePops() { $('menupop').hidden = true; $('noticepop').hidden = true; }
  // Restart this chat keeps the visitor and the thread (the team sees a line saying so) and the window starts clean. Ending the chat
  // resolves the thread and makes a fresh visitor, so the next visit is a new chat. Either way the window loads again, and closing the
  // page (not this reload) tells the server the visitor left. The Customize preview has no conversation, so it only hides.
  var reloading = false;
  function startOver(hide, ended) {
    closePops();
    reloading = true;
    function done() {
      if (hide) { try { window.parent.postMessage({ wgt: 'close' }, '*'); } catch (e) {} }
      if (!PREVIEW) location.reload();
    }
    if (PREVIEW) { done(); return; }
    var ending = ended
      ? fetch(withVid(BASE + 'end?reason=ended'), { method: 'POST', credentials: 'include' }).catch(function () {})
      : Promise.resolve();
    ending
      .then(function () { return fetch(withVid(BASE + 'restart' + (ended ? '?fresh=1' : '')), { method: 'POST', credentials: 'include' }); })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.visitor_uuid) storeUuid(j.visitor_uuid); })
      .catch(function () {})
      .then(done);
  }
  window.addEventListener('pagehide', function () {
    if (PREVIEW || reloading || !storedUuid()) return;
    try { navigator.sendBeacon(withVid(BASE + 'end?reason=left')); } catch (e) {}
  });
  // The cross asks first. "End conversation" then asks for a rating and closes the chat (the thread is resolved and the next visit is a
  // new chat); "Restart chat" gives the default five stars and starts the same thread over; "Not now" only closes the question.
  function rate(stars, comment) {
    if (PREVIEW) return Promise.resolve();
    var payload = { rating: stars };
    if (comment) payload.comment = comment;
    var vid = storedUuid();
    if (vid) payload.visitor_uuid = vid;
    return fetch(API_RATE, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(function () {});
  }
  function sheet(build) {
    var m = $('endmodal');
    m.textContent = '';
    var sh = document.createElement('div');
    sh.className = 'sheet';
    sh.setAttribute('role', 'dialog');
    sh.setAttribute('aria-modal', 'true');
    build(sh);
    m.appendChild(sh);
    m.hidden = false;
    var first = sh.querySelector('button');
    if (first) first.focus();
  }
  function closeSheet() { var m = $('endmodal'); m.hidden = true; m.textContent = ''; }
  function sheetButton(cls, label, fn) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = label; b.onclick = fn;
    return b;
  }
  function openEnd() {
    sheet(function (sh) {
      var wi = document.createElement('div');
      wi.className = 'wi';
      wi.appendChild(svg(22, ['M12 9v4', 'M12 17h.01', 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z']));
      sh.appendChild(wi);
      var q = document.createElement('p');
      q.className = 'q';
      q.id = 'endq';
      q.textContent = tx('endTitle', 'Are you sure you want to end conversation?');
      sh.setAttribute('aria-labelledby', 'endq');
      sh.appendChild(q);
      sh.appendChild(sheetButton('danger', tx('endConversation', 'End conversation'), openRating));
      sh.appendChild(sheetButton('outline', tx('restartChat', 'Restart chat'), function () { closeSheet(); rate(5).then(function () { startOver(true, false); }); }));
      sh.appendChild(sheetButton('ghost', tx('notNow', 'Not now'), closeSheet));
    });
  }
  function openRating() {
    var stars = 5;
    sheet(function (sh) {
      var t = document.createElement('p');
      t.className = 'q';
      t.textContent = tx('rateTitle', 'Please rate your experience with us.');
      sh.appendChild(t);
      var row = document.createElement('div');
      row.className = 'stars';
      row.setAttribute('role', 'radiogroup');
      var lab = document.createElement('div');
      lab.className = 'rlabel';
      lab.setAttribute('role', 'status');
      var names = [tx('rate1', 'Very poor'), tx('rate2', 'Poor'), tx('rate3', 'Average'), tx('rate4', 'Good'), tx('rate5', 'Excellent')];
      var bs = [];
      function paint() {
        bs.forEach(function (b, i) { b.className = i < stars ? 'on' : ''; b.setAttribute('aria-checked', String(i + 1 === stars)); });
        lab.textContent = names[stars - 1];
      }
      for (var i = 1; i <= 5; i++) (function (n) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-label', tx('rateStar', '{n} / 5').replace('{n}', String(n)));
        b.textContent = '\u2605';
        b.onclick = function () { stars = n; paint(); };
        bs.push(b);
        row.appendChild(b);
      })(i);
      sh.appendChild(row);
      sh.appendChild(lab);
      var ta = document.createElement('textarea');
      ta.maxLength = 1000;
      ta.placeholder = tx('suggestPh', 'Type your suggestions here...');
      sh.appendChild(ta);
      sh.appendChild(sheetButton('accent', tx('submitFeedback', 'Submit feedback'), function () { closeSheet(); rate(stars, ta.value.trim()).then(function () { startOver(true, true); }); }));
      sh.appendChild(sheetButton('ghost', tx('noThanks', 'No, thanks'), function () { closeSheet(); startOver(true, true); }));
      paint();
    });
  }
  // The header's bell (notification cards) and menu (rows or blocks).
  function paintHeaderPops(hdr) {
    var np = $('noticepop'), mp = $('menupop');
    np.textContent = ''; mp.textContent = ''; np.hidden = true; mp.hidden = true;
    if (!popsBound) { popsBound = true; document.addEventListener('click', function (e) { if (!e.target.closest || !e.target.closest('.pop')) closePops(); }); }
    var nt = CHAT.notice || {};
    var cards = (nt.items || []).filter(function (c) { return c.title; });
    if (nt.enabled && cards.length) {
      cards.forEach(function (c) {
        var el = document.createElement('div'); el.className = 'nc';
        if (imgUrl(c.image)) { var im = document.createElement('img'); im.src = imgUrl(c.image); im.alt = ''; el.appendChild(im); }
        var body = document.createElement('div'); body.className = 'nb';
        var t1 = document.createElement('div'); t1.className = 'nt'; t1.textContent = c.title; body.appendChild(t1);
        var t2 = document.createElement('div'); t2.className = 'nd'; t2.textContent = c.description || ''; body.appendChild(t2);
        if (c.buttonTitle && safeAction(c.buttonUrl)) {
          var a = document.createElement('a'); a.className = 'nbtn'; a.textContent = c.buttonTitle; a.href = safeAction(c.buttonUrl);
          if (/^https?:/i.test(a.href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
          body.appendChild(a);
        }
        if (c.footer) { var t3 = document.createElement('div'); t3.className = 'nf'; t3.textContent = c.footer; body.appendChild(t3); }
        el.appendChild(body); np.appendChild(el);
      });
      var ICONS = { 1: ['M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7', 'M10 20a2 2 0 0 0 4 0'], 2: ['M3 8h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z', 'M14 8v10'], 3: ['M4 5h16v4H4z', 'M5 9v10h14V9', 'M10 13h4'], 4: ['M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z', 'M17 4h.01'] };
      var bell = document.createElement('button');
      bell.type = 'button'; bell.className = 'hx';
      bell.setAttribute('aria-label', tx('notifications', 'Notifications'));
      bell.setAttribute('aria-haspopup', 'true');
      bell.appendChild(svg(18, ICONS[nt.icon] || ICONS[1]));
      var dot = document.createElement('i'); dot.className = 'dot'; bell.appendChild(dot);
      bell.onclick = function (e) { e.stopPropagation(); var on = np.hidden; closePops(); np.hidden = !on; dot.remove(); };
      hdr.appendChild(bell);
    }
    var qm = CHAT.quickMenu || {};
    var rows = (qm.items || []).filter(function (r) { return r.title; });
    if (qm.enabled && rows.length) {
      mp.className = 'pop' + (qm.view === 'blocks' ? ' blocks' : '');
      rows.forEach(function (r) {
        var url = safeAction(r.url);
        var el = document.createElement(url ? 'a' : 'button');
        el.className = 'mi';
        if (url) { el.href = url; if (/^https?:/i.test(url)) { el.target = '_blank'; el.rel = 'noopener noreferrer'; } }
        else { el.type = 'button'; var jump = jumpId(r.node); el.onclick = function () { closePops(); if (jump) send(r.title, jump); else send(r.title); }; }
        if (imgUrl(r.image)) { var im = document.createElement('img'); im.src = imgUrl(r.image); im.alt = ''; el.appendChild(im); }
        var sp = document.createElement('span'); sp.textContent = r.title; el.appendChild(sp);
        mp.appendChild(el);
      });
      var mn = document.createElement('button');
      mn.type = 'button'; mn.className = 'hx';
      mn.setAttribute('aria-label', tx('menu', 'Menu'));
      mn.setAttribute('aria-haspopup', 'true');
      // The menu is a hamburger at the start of the header, in front of the picture.
      mn.appendChild(svg(20, ['M4 7h16', 'M4 12h16', 'M4 17h16']));
      mn.onclick = function (e) { e.stopPropagation(); var on = mp.hidden; closePops(); mp.hidden = !on; };
      hdr.insertBefore(mn, hdr.firstChild);
      mp.classList.add('at-start');
    }
  }

  function renderSuggestions() {
    var box = $('sugg');
    box.textContent = '';
    var list = CHAT.suggestions || [];
    if (!list.length || visitorSpoke || CHAT.suggestionsOn === false) { box.hidden = true; return; }
    list.forEach(function (s, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = s;
      var jump = jumpId((CHAT.suggestionNodes || [])[i]);
      b.onclick = function () { if (jump) send(s, jump); else send(s); };
      box.appendChild(b);
    });
    box.setAttribute('aria-label', tx('suggestions', 'Suggestions'));
    box.hidden = false;
  }
  function visitorSpeaks() { if (!visitorSpoke) { visitorSpoke = true; renderSuggestions(); } }

  function postFeedback(id, value) {
    var payload = { message_id: Number(id), value: value };
    var vid = storedUuid();
    if (vid) payload.visitor_uuid = vid;
    fetch(API_FB, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(function () {});
  }

  function copyText(text, btn) {
    var done = function () {
      btn.title = tx('copied', 'Copied');
      btn.setAttribute('aria-label', tx('copied', 'Copied'));
      setTimeout(function () { btn.title = tx('copy', 'Copy'); btn.setAttribute('aria-label', tx('copy', 'Copy')); }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      ta.remove();
    }
  }

  // Copy, helpful and not helpful under a line the bot sent (a line with an id: the welcome bubble has none).
  function actionsNode(id, text) {
    var box = document.createElement('span');
    box.className = 'acts';
    function mk(label, paths, cls, onclick) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'act ' + cls;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.appendChild(svg(14, paths));
      b.onclick = onclick;
      return b;
    }
    var up, down;
    var thumb = ['M7 11v9H4v-9z', 'M7 11l4-8a2 2 0 0 1 3 2l-1 6h5a2 2 0 0 1 2 2.4l-1.3 6A2 2 0 0 1 16.7 20H7'];
    function vote(v) {
      var cur = up.getAttribute('aria-pressed') === 'true' ? 'up' : down.getAttribute('aria-pressed') === 'true' ? 'down' : null;
      var next = cur === v ? null : v;
      up.setAttribute('aria-pressed', String(next === 'up'));
      down.setAttribute('aria-pressed', String(next === 'down'));
      postFeedback(id, next);
    }
    var cp = mk(tx('copy', 'Copy'), ['M9 9h11v11H9z', 'M5 15V6a2 2 0 0 1 2-2h8'], 'copy', function () { copyText(text, cp); });
    up = mk(tx('helpful', 'Helpful'), thumb, 'up', function () { vote('up'); });
    down = mk(tx('notHelpful', 'Not helpful'), thumb, 'down', function () { vote('down'); });
    up.setAttribute('aria-pressed', 'false');
    down.setAttribute('aria-pressed', 'false');
    box.appendChild(cp);
    // Feedback off hides the thumbs; its message is kept in the settings for when it is switched back on.
    if (!CHAT.feedback || CHAT.feedback.enabled !== false) {
      box.appendChild(up);
      box.appendChild(down);
      var thanks = CHAT.feedback && CHAT.feedback.message;
      if (thanks) {
        var note = document.createElement('span');
        note.className = 'fbmsg';
        note.setAttribute('role', 'status');
        note.hidden = true;
        note.textContent = thanks;
        box.appendChild(note);
        var shown = vote;
        vote = function (v) { shown(v); note.hidden = up.getAttribute('aria-pressed') !== 'true' && down.getAttribute('aria-pressed') !== 'true'; };
      }
    }
    return box;
  }

  // Voice conversation: the browser's own speech recognition listens, its speech synthesis reads the bot's answers aloud.
  var voiceOn = false, rec = null;
  function setPhase(phase, line) {
    var key = phase === 'listen' ? 'voiceListening' : phase === 'think' ? 'voiceThinking' : 'voiceSpeaking';
    $('vphase').textContent = tx(key, phase === 'listen' ? 'Listening' : phase === 'think' ? 'Thinking' : 'Speaking');
    $('vline').textContent = line || '';
  }
  function listen() {
    if (!voiceOn) return;
    setPhase('listen', '');
    rec = new SR();
    rec.lang = document.documentElement.lang || navigator.language || 'en';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = function (e) {
      var t = '', fin = false;
      for (var i = e.resultIndex; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) fin = true; }
      $('vline').textContent = t;
      if (fin) { setPhase('think', t); send(t); }
    };
    rec.onerror = function () { if (voiceOn) setTimeout(listen, 900); };
    try { rec.start(); } catch (e) {}
  }
  function speak(text) {
    if (!voiceOn || !text) return;
    setPhase('speak', text);
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = document.documentElement.lang || navigator.language || 'en';
      var again = function () { if (voiceOn && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) listen(); };
      u.onend = again;
      u.onerror = again;
      window.speechSynthesis.speak(u);
    } catch (e) { listen(); }
  }
  function startVoice() {
    if (!(SR && window.speechSynthesis)) { addBubble('in', tx('voiceUnsupported', 'Voice is not available in this browser.')); return; }
    voiceOn = true;
    $('voice').hidden = false;
    listen();
  }
  function stopVoice() {
    voiceOn = false;
    try { if (rec) rec.abort(); } catch (e) {}
    try { window.speechSynthesis.cancel(); } catch (e) {}
    $('voice').hidden = true;
  }

  // Colour helpers: the author's colours drive the look, a tint and a gradient are derived from them.
  function hexRgb(h) { var m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); if (!m) return null; var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbHex(c) { return '#' + c.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
  function mix(h, to, t) { var a = hexRgb(h), b = hexRgb(to); if (!a || !b) return h; return rgbHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
  function svg(size, paths) {
    var NS = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    paths.forEach(function (d) { var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p); });
    return s;
  }

  var typingEl = null, typingTimer = null;
  function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } clearTimeout(typingTimer); }
  // The bot is working on an answer: three dots until its line arrives (or a while has passed).
  function showTyping() {
    hideTyping();
    var t = document.createElement('div');
    t.className = 'typing';
    t.setAttribute('aria-label', tx('typing', 'The bot is typing'));
    for (var i = 0; i < 3; i++) t.appendChild(document.createElement('i'));
    $('msgs').appendChild(t);
    typingEl = t;
    toBottom();
    typingTimer = setTimeout(hideTyping, 12000);
  }

  function nearBottom() { var m = $('msgs'); return m.scrollHeight - m.scrollTop - m.clientHeight < 70; }
  function toBottom() { var m = $('msgs'); m.scrollTop = m.scrollHeight; $('latest').style.display = 'none'; }

  // WhatsApp's own marks in a line the bot sent: *bold*, _italic_, ~strike~ and three backticks for monospace. Built as elements with
  // textContent, never as markup, so nothing in the text can add any. A mark inside a word (snake_case, a link) is left as typed.
  var MARKS = /\\x60\\x60\\x60([^\\n]+?)\\x60\\x60\\x60|\\*(?=\\S)([^*\\n]*?\\S)\\*|_(?=\\S)([^_\\n]*?\\S)_|~(?=\\S)([^~\\n]*?\\S)~/g;
  function fmtInto(el, text) {
    // Its own regex per call: the nested call for *bold _italic_* must not move this one's position.
    var re = new RegExp(MARKS.source, 'g');
    var last = 0, m;
    while ((m = re.exec(text)) !== null) {
      var mono = m[1] !== undefined;
      if (!mono && (/\\w/.test(text.charAt(m.index - 1)) || /\\w/.test(text.charAt(m.index + m[0].length)))) { re.lastIndex = m.index + 1; continue; }
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      var tag = mono ? 'code' : m[2] !== undefined ? 'b' : m[3] !== undefined ? 'i' : 's';
      var inner = mono ? m[1] : m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
      var n = document.createElement(tag);
      if (mono) n.textContent = inner; else fmtInto(n, inner);
      el.appendChild(n);
      last = m.index + m[0].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }
  // The same line without its marks, for the voice that reads it out.
  function plain(text) {
    var d = document.createElement('div');
    fmtInto(d, text);
    return d.textContent;
  }

  function addBubble(dir, text, extras) {
    if (dir === 'in') { hideTyping(); setHint(extras && extras.input ? extras.input : null); }
    // A file the visitor sent in an earlier visit has no text of its own.
    if (dir === 'out' && !text) return;
    var m = $('msgs');
    var stick = dir === 'out' || nearBottom();
    var row = document.createElement('div');
    row.className = 'row ' + dir;
    var b = document.createElement('div');
    b.className = 'bubble ' + dir;
    if (dir === 'in' && cfg) {
      b.style.background = cfg.bubble_color || '#FFFFFF';
      b.style.color = cfg.bubble_text || '#222222';
    }
    if (extras && extras.media) {
      b.classList.add('media');
      b.appendChild(mediaNode(extras.media));
      if (text) {
        var cap = document.createElement('div');
        cap.className = 'cap';
        if (dir === 'in') fmtInto(cap, text); else cap.textContent = text;
        b.appendChild(cap);
      }
    } else if (dir === 'in') {
      fmtInto(b, text);
    } else {
      b.textContent = text;
    }
    // A carousel without an intro line is only its cards.
    if (text || !(extras && extras.cards && extras.cards.length) || (extras && extras.media)) row.appendChild(b);
    // Link, call and email buttons: only the schemes a browser may open, checked again here.
    if (extras && extras.links && extras.links.length) {
      var lk = document.createElement('div');
      lk.className = 'links';
      extras.links.forEach(function (l) { var a = linkNode(l.label, l.url, l.icon); if (a) lk.appendChild(a); });
      if (lk.children.length) row.appendChild(lk);
    }
    // A carousel: cards the visitor scrolls through, each with its own buttons.
    if (extras && extras.cards && extras.cards.length) {
      row.classList.add('wide');
      row.appendChild(cardsNode(extras.cards));
    }
    // A line shows when it was sent; lines of an earlier visit (no time kept) show none.
    var when = extras && extras.noTime ? null : extras && extras.at ? new Date(extras.at) : new Date();
    if (when && !isNaN(when.getTime())) {
      var tm = document.createElement('div');
      tm.className = 'time';
      tm.textContent = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (dir === 'out') tm.appendChild(svg(13, ['M2 13l3.5 3.5L13 9', 'M11 16l1 1 8.5-9']));
      if (dir === 'in' && CHAT.actions && extras && extras.id && text) tm.appendChild(actionsNode(extras.id, text));
      row.appendChild(tm);
    }
    if (dir === 'in' && voiceOn && text) speak(plain(text));
    if (dir === 'in' && imgUrl(CHAT.avatar)) {
      var bi = document.createElement('img');
      bi.className = 'bav'; bi.src = imgUrl(CHAT.avatar); bi.alt = '';
      row.classList.add('has-av');
      row.insertBefore(bi, row.firstChild);
    }
    if (dir === 'in' && settled) blip();
    if (dir === 'in' && settled && text && CHAT.speak && !voiceOn && window.speechSynthesis) { try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(plain(text))); } catch (e) {} }
    if (extras && extras.id) row.dataset.id = extras.id;
    // Reply buttons stay where the bot put them, also after one is tapped (the run keeps an old menu tappable): the tapped one is marked.
    m.appendChild(row);
    if (extras && extras.buttons && extras.buttons.length) addChips(extras.buttons);
    if (stick) toBottom(); else $('latest').style.display = 'flex';
  }

  // A button that opens a page, a call or an email: only schemes a browser may open, and a page opens in a new tab.
  function linkNode(label, url, icon) {
    var u = String(url || '');
    if (!/^(https?:\\/\\/|tel:|mailto:)/i.test(u)) return null;
    var a = document.createElement('a');
    a.className = 'chip link';
    a.href = u;
    if (/^https?:/i.test(u)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    var lpic = imgUrl(icon);
    // The author's own picture only: a button without one has no icon.
    if (lpic) { var li = document.createElement('img'); li.src = lpic; li.alt = ''; li.className = 'lico'; a.appendChild(li); }
    a.appendChild(document.createTextNode(String(label || '') || tx('open', 'Open')));
    return a;
  }

  // The cards of a carousel. A reply button sends the visitor's tap (its id) like a quick reply; everything is put in as text.
  function cardsNode(cards) {
    var wrap = document.createElement('div');
    wrap.className = 'cards';
    wrap.setAttribute('role', 'list');
    cards.forEach(function (c) {
      var el = document.createElement('div');
      el.className = 'card';
      el.setAttribute('role', 'listitem');
      var cardImg = imgUrl(c.image);
      if (cardImg) {
        var img = document.createElement('img');
        img.alt = c.title || '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        // A picture a host will not give without a referrer is asked for once more with the window's origin; failing that, the card shows without it.
        img.onerror = function () {
          if (img.dataset.retry) { img.remove(); return; }
          img.dataset.retry = '1';
          img.referrerPolicy = 'origin';
          img.src = cardImg;
        };
        img.src = cardImg;
        el.appendChild(img);
      }
      var cb = document.createElement('div');
      cb.className = 'cb';
      if (c.title) { var ct = document.createElement('div'); ct.className = 'ct'; ct.textContent = c.title; cb.appendChild(ct); }
      if (c.text) { var tx = document.createElement('div'); tx.className = 'tx'; fmtInto(tx, c.text); cb.appendChild(tx); }
      el.appendChild(cb);
      var bt = document.createElement('div');
      bt.className = 'bt';
      (c.buttons || []).forEach(function (btn) {
        if (btn.kind === 'reply') {
          var r = document.createElement('button');
          r.type = 'button';
          r.className = 'chip';
          r.textContent = btn.title;
          r.onclick = function () { send(btn.title, btn.id); };
          bt.appendChild(r);
        } else {
          var a = linkNode(btn.label, btn.url);
          if (a) bt.appendChild(a);
        }
      });
      if (bt.children.length) el.appendChild(bt);
      wrap.appendChild(el);
    });
    return wrap;
  }

  // A file the bot sent: drawn by its kind, read through this visitor's own thread. The name is only ever put in with textContent.
  function mediaNode(media) {
    var url = withVid(media.url);
    if (media.kind === 'image') {
      var img = document.createElement('img');
      img.className = 'shot';
      img.alt = media.name || '';
      img.src = url;
      img.onclick = function () { window.open(url, '_blank', 'noopener'); };
      return img;
    }
    if (media.kind === 'video' || media.kind === 'audio') {
      var el = document.createElement(media.kind);
      el.controls = true;
      el.preload = 'metadata';
      el.src = url;
      return el;
    }
    var a = document.createElement('a');
    a.className = 'doc';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    var ico = document.createElement('span');
    ico.className = 'ico';
    var dot = String(media.name || '').lastIndexOf('.');
    ico.textContent = dot >= 0 ? String(media.name).slice(dot + 1, dot + 5).toUpperCase() : 'FILE';
    var nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = media.name || 'file';
    var dl = document.createElement('span');
    dl.className = 'dl';
    dl.appendChild(svg(16, ['M12 3v12M7 11l5 5 5-5M4 20h16']));
    a.appendChild(ico);
    a.appendChild(nm);
    a.appendChild(dl);
    return a;
  }

  function clearChips() {
    var old = document.querySelectorAll('.chips');
    for (var i = 0; i < old.length; i++) old[i].remove();
  }

  function addChips(buttons) {
    var box = document.createElement('div');
    box.className = 'chips';
    buttons.forEach(function (btn) {
      var c = document.createElement('button');
      c.type = 'button';
      c.className = 'chip menu';
      // The author's own small picture, and only that: a button without one has no icon.
      var pic = imgUrl(btn.icon);
      if (pic) {
        var ico = document.createElement('span');
        ico.className = 'ico pic';
        var im = document.createElement('img'); im.src = pic; im.alt = ''; ico.appendChild(im);
        c.appendChild(ico);
      }
      c.appendChild(document.createTextNode(btn.title));
      c.onclick = function () {
        var sib = box.querySelectorAll('.chip.menu');
        for (var k = 0; k < sib.length; k++) sib[k].classList.remove('picked');
        c.classList.add('picked');
        send(btn.title, btn.id);
      };
      box.appendChild(c);
    });
    $('msgs').appendChild(box);
  }

  // On its own page (not inside a site's panel) the window keeps the size the author chose instead of filling the browser.
  function frameStandalone() {
    if (window.parent !== window || PREVIEW) return;
    var sz = SIZES[CHAT.size] || SIZES.standard;
    var root = document.documentElement;
    root.style.setProperty('--win-w', sz.w + 'px');
    root.style.setProperty('--win-h', sz.h + 'px');
    root.classList.add('standalone');
  }
  function paintChrome() {
    // The options first: the header fill and the direction depend on them.
    applyOptions();
    frameStandalone();
    document.body.style.background = cfg.body_bg_kind === 'image' && cfg.body_bg_image_url ? '#fff' : cfg.body_bg_color || '#F7F8FC';
    var msgs = $('msgs');
    var safeUrl = '';
    if (cfg.body_bg_kind === 'image' && cfg.body_bg_image_url) {
      try {
        var u = new URL(String(cfg.body_bg_image_url), window.location.href);
        if (u.protocol === 'http:' || u.protocol === 'https:') safeUrl = u.href.replace(/['"()\\\\]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
      } catch (e) { safeUrl = ''; }
    }
    var chatBg = imgUrl(CHAT.background);
    if (chatBg) {
      msgs.style.backgroundColor = cfg.body_bg_color || '#F7F8FC';
      msgs.style.backgroundImage = 'url("' + chatBg.replace(/["\\\\]/g, encodeURIComponent) + '")';
      msgs.style.backgroundSize = 'cover';
      msgs.style.backgroundPosition = 'center';
    } else if (safeUrl) {
      msgs.style.backgroundImage = "url('" + safeUrl + "')";
      msgs.style.backgroundSize = 'cover';
    } else {
      msgs.style.background = cfg.body_bg_color || '#F7F8FC';
    }
    var hdr = $('hdr');
    var hb = cfg.header_bg || '#5B4DDB';
    hdr.style.background = headerFill(hb);
    hdr.style.color = cfg.header_text || '#FFFFFF';
    hdr.style.setProperty('--hdr', hb);
    hdr.textContent = '';
    var av = document.createElement('span');
    av.className = 'av';
    // The company's logo takes the round place in the header; the bot's own picture sits beside each bot line.
    var logoPic = imgUrl(CHAT.logo);
    if (logoPic) {
      av.classList.add('has-logo');
      var avi = document.createElement('img');
      avi.src = logoPic; avi.alt = '';
      av.appendChild(avi);
    } else av.appendChild(svg(22, ['M6 8h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M12 8V4.5', 'M9 13h.01M15 13h.01M9.5 16h5']));
    av.appendChild(document.createElement('i'));
    var ttl = document.createElement('div');
    ttl.className = 'ttl';
    var nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = cfg.header_title || 'Chat';
    var st = document.createElement('div');
    st.className = 'st';
    st.textContent = tx('online', 'Online');
    ttl.appendChild(nm);
    ttl.appendChild(st);
    hdr.appendChild(av);
    hdr.appendChild(ttl);
    paintHeaderPops(hdr);
    paintBanner();
    // Inside the site's panel (a flow bot's) the window can be made larger and smaller.
    if (FLOW && window.parent !== window && CHAT.expand) {
      var ex = document.createElement('button');
      ex.type = 'button';
      ex.className = 'hx';
      ex.dataset.end = '1';
      var big = false;
      var grow = ['M9 3H3v6', 'M15 21h6v-6', 'M21 9V3h-6', 'M3 15v6h6'];
      ex.setAttribute('aria-label', tx('expand', 'Expand'));
      ex.appendChild(svg(18, grow));
      ex.onclick = function () {
        big = !big;
        ex.setAttribute('aria-label', big ? tx('collapse', 'Collapse') : tx('expand', 'Expand'));
        try { window.parent.postMessage({ wgt: 'expand', on: big }, '*'); } catch (e) {}
      };
      hdr.appendChild(ex);
    }
    // Inside the site's panel (any website bot) the window has its own cross. It asks whether to end the conversation (see openEnd).
    if (window.parent !== window) {
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'hx';
      x.dataset.end = '1';
      x.setAttribute('aria-label', tx('closeChat', 'Close chat'));
      x.setAttribute('aria-haspopup', 'dialog');
      x.appendChild(svg(20, ['M6 6l12 12', 'M18 6L6 18']));
      x.onclick = function (e) { e.stopPropagation(); closePops(); openEnd(); };
      // Minimize: the panel folds back into the launcher ball and the conversation stays as it is.
      var mn = document.createElement('button');
      mn.type = 'button';
      mn.className = 'hx';
      mn.dataset.minimize = '1';
      mn.setAttribute('aria-label', tx('minimize', 'Minimize'));
      mn.title = tx('minimize', 'Minimize');
      mn.appendChild(svg(20, ['M6 19h12']));
      mn.onclick = function (e) { e.stopPropagation(); closePops(); try { window.parent.postMessage({ wgt: 'close' }, '*'); } catch (err) {} };
      hdr.appendChild(mn);
      hdr.appendChild(x);
    }
    var acc = cfg.button_bg || '#5B4DDB';
    var root = document.documentElement.style;
    root.setProperty('--accent', acc);
    root.setProperty('--accent-ink', cfg.button_text || '#FFFFFF');
    root.setProperty('--accent-soft', mix(acc, '#FFFFFF', 0.9));
    root.setProperty('--accent-line', mix(acc, '#FFFFFF', 0.68));
    // The send button is a paper plane. Empty box: an outline in the accent colour; with text: filled. The label is its name.
    var btn = $('send');
    var lbl = cfg.button_label || 'Send';
    btn.textContent = '';
    btn.setAttribute('aria-label', lbl);
    btn.title = lbl;
    btn.appendChild(svg(18, ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4z']));
    ensurePipButton();
    btn.style.removeProperty('background');
    btn.style.removeProperty('color');
    syncSend();
  }
  function syncSend() { $('send').classList.toggle('empty', !$('txt').value.trim()); }

  function announceToParent() {
    toParent({ wgt: 'hello' });
    toParent({ wgt: 'pip-text', title: (cfg && cfg.header_title) || '', body: tx('pipNotify', 'Tap to continue chatting in a floating window') });
  }

  function addWaCta() {
    var a = document.createElement('a');
    a.href = cfg.whatsapp_url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'wa-cta';
    a.textContent = tx('openWhatsapp', 'Open WhatsApp');
    $('msgs').appendChild(a);
  }

  // The optional age question of the intake form (BL-218). It is never pre-filled and never says which answer passes. A refusal is
  // remembered for this tab only (the server keeps nothing about a refused visitor).
  var AGELOCK = 'wsnap_age_' + TOKEN;
  function ageLocked() {
    try { return window.sessionStorage.getItem(AGELOCK) === '1'; } catch (e) { return false; }
  }
  function ageError(text) {
    var el = $('i-age-err');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'block';
  }
  function blockChat(remember) {
    if (remember) { try { window.sessionStorage.setItem(AGELOCK, '1'); } catch (e) { /* a courtesy only */ } }
    hideTyping();
    intakeDone = true;
    $('intake').style.display = 'none';
    $('msgs').textContent = '';
    addBubble('in', tx('ageBlocked', 'We are not able to continue this chat.'));
    $('send').disabled = true;
    $('txt').disabled = true;
  }
  function reopenIntake() {
    hideTyping();
    intakeDone = false;
    $('send').disabled = true;
    $('intake').style.display = 'block';
    ageError(tx('ageRequired', 'Please answer this question to continue.'));
  }

  function field(box, labelText, id, type) {
    var l = document.createElement('label');
    l.textContent = labelText;
    var i = document.createElement('input');
    i.id = id;
    i.type = type;
    box.appendChild(l);
    box.appendChild(i);
  }

  function renderIntake() {
    var box = $('intake');
    box.textContent = '';
    var t = document.createElement('div');
    t.className = 'title';
    t.textContent = tx('intakeTitle', 'Tell us a bit about you');
    box.appendChild(t);
    if (cfg.age_gate && cfg.age_gate.pending) {
      if (cfg.age_gate.mode === 'dob') {
        field(box, tx('ageDobLabel', 'Date of birth'), 'i-dob', 'date');
        $('i-dob').setAttribute('autocomplete', 'off');
      } else if (cfg.age_gate.mode === 'age') {
        field(box, tx('ageAgeLabel', 'Your age'), 'i-age', 'text');
        var ageIn = $('i-age');
        ageIn.setAttribute('inputmode', 'numeric');
        ageIn.setAttribute('maxlength', '3');
        ageIn.setAttribute('autocomplete', 'off');
      } else {
        var arow = document.createElement('label');
        arow.className = 'consent';
        var abox = document.createElement('input');
        abox.type = 'checkbox';
        abox.id = 'i-age-ok';
        arow.appendChild(abox);
        var atext = document.createElement('span');
        atext.textContent = tx('ageDeclaration', 'I confirm I am at least {n} years old').replace('{n}', String(cfg.age_gate.declaration_age || 0));
        atext.setAttribute('dir', 'auto');
        arow.appendChild(atext);
        box.appendChild(arow);
      }
      var aerr = document.createElement('div');
      aerr.id = 'i-age-err';
      aerr.className = 'age-err';
      aerr.style.display = 'none';
      aerr.setAttribute('role', 'alert');
      box.appendChild(aerr);
    }
    // The optional consent line: unticked by default. Only the wording the workspace wrote is shown, as plain text.
    if (cfg.consent && cfg.consent.text && (cfg.collect_email || cfg.collect_phone)) {
      var crow = document.createElement('label');
      crow.className = 'consent';
      var cbox = document.createElement('input');
      cbox.type = 'checkbox';
      cbox.id = 'i-consent';
      crow.appendChild(cbox);
      var ctext = document.createElement('span');
      ctext.textContent = cfg.consent.text;
      ctext.setAttribute('dir', 'auto');
      crow.appendChild(ctext);
      if (cfg.consent.url) {
        var clink = document.createElement('a');
        clink.href = cfg.consent.url;
        clink.target = '_blank';
        clink.rel = 'noopener noreferrer';
        clink.textContent = cfg.consent.url.replace(/^https:[/][/]/, '').split('/')[0];
        ctext.appendChild(document.createTextNode(' '));
        ctext.appendChild(clink);
      }
      box.appendChild(crow);
    }
    var go = document.createElement('button');
    go.id = 'i-go';
    go.type = 'button';
    go.textContent = tx('continue', 'Continue');
    go.onclick = function () {
      if (cfg.age_gate && cfg.age_gate.pending) {
        var missing = (cfg.age_gate.mode === 'dob' && !$('i-dob').value) || (cfg.age_gate.mode === 'age' && !$('i-age').value.trim());
        if (missing) { ageError(tx('ageRequired', 'Please answer this question to continue.')); return; }
      }
      intakeDone = true;
      box.style.display = 'none';
      $('send').disabled = false;
      $('txt').focus();
    };
    box.appendChild(go);
    box.style.display = 'block';
  }

  function loadConfig() {
    return fetch(withVid(API_CFG), { credentials: 'include' })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        cfg = data.widget;
        var vis = data.visitor || {};
        storeUuid(vis.uuid);
        paintChrome();
        announceToParent();
        var transcript = data.transcript || [];
        if (transcript.length) {
          transcript.forEach(function (m, i) {
            addBubble(m.dir === 'out' ? 'out' : 'in', m.body || '', { id: m.id, noTime: true, cards: m.cards, links: m.links, media: m.media, input: i === transcript.length - 1 ? m.input : null, buttons: i === transcript.length - 1 ? m.buttons : null });
            if ((m.id || 0) > lastSeenMsgId) lastSeenMsgId = m.id;
          });
        } else if (cfg.welcome_message) {
          addBubble('in', cfg.welcome_message);
        }
        if (transcript.some(function (m) { return m.dir === 'out'; })) visitorSpoke = true;
        renderSuggestions();
        settled = true;
        if (cfg.whatsapp_url && cfg.mode !== 'ai') addWaCta();
        var ageAsk = !!(cfg.age_gate && cfg.age_gate.pending);
        if (ageAsk) {
          renderIntake();
        } else {
          intakeDone = true;
          $('send').disabled = false;
          botReady = transcript.length === 0;
          startBot();
        }
        if (ageAsk && ageLocked()) blockChat(false);
      });
    // QUIRK: reproduced deliberately (TW-WGT-009 rule 4). A failed config (403, 404) is not handled: the page stays empty
    // with a disabled Send button.
  }

  // The visitor shares where they are, when the bot asked: the browser's own permission prompt decides.
  function shareLocation() {
    var b = $('locbtn');
    if (PREVIEW || b.disabled) return;
    if (!navigator.geolocation) { addBubble('in', tx('locationDenied', 'We could not get your location. Please allow location access and try again.'), { input: hint }); return; }
    b.disabled = true;
    navigator.geolocation.getCurrentPosition(function (pos) {
      b.disabled = false;
      visitorSpeaks();
      addBubble('out', '\\uD83D\\uDCCD ' + tx('shareLocation', 'Share my location'));
      showTyping();
      var payload = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      var vid = storedUuid();
      if (vid) payload.visitor_uuid = vid;
      fetch(API_LOC, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function () { burstPoll(); })
        .catch(function () { addBubble('in', tx('failed', "Sorry, that didn't go through. Please try again."), { input: hint }); });
    }, function () {
      b.disabled = false;
      addBubble('in', tx('locationDenied', 'We could not get your location. Please allow location access and try again.'), { input: hint });
    }, { enableHighAccuracy: false, timeout: 15000 });
  }
  $('locbtn').addEventListener('click', shareLocation);

  function send(tapTitle, tapId) {
    if (PREVIEW) return;
    var txt = $('txt');
    var body = typeof tapTitle === 'string' ? tapTitle : (txt.value || '').trim();
    if (!body) return;
    // A phone answer typed without a plus gets the chosen country's code in front of it.
    if (typeof tapTitle !== 'string' && hint && hint.type === 'phone' && body.charAt(0) !== '+') body = '+' + $('cc').value + ' ' + body.replace(/^0+/, '');
    visitorSpeaks();
    toParent({ wgt: 'activity' });
    if (typeof tapTitle !== 'string') txt.value = '';
    addBubble('out', body);
    var payload = { body: body };
    if (tapId) payload.tap_id = tapId;
    var vid = storedUuid();
    if (vid) payload.visitor_uuid = vid;
    if (intakeDone) {
      var n = $('i-name'); if (n && n.value) payload.name = n.value;
      var e = $('i-email'); if (e && e.value) payload.email = e.value;
      var p = $('i-phone'); if (p && p.value) payload.phone = p.value;
      var c = $('i-consent');
      if (c && c.checked && cfg.consent) { payload.consent = true; payload.consent_version = cfg.consent.version; }
      var dobIn = $('i-dob'); if (dobIn && dobIn.value) payload.date_of_birth = dobIn.value;
      var ageIn2 = $('i-age'); if (ageIn2 && ageIn2.value.trim()) payload.age = ageIn2.value.trim();
      var ageOk = $('i-age-ok'); if (ageOk) payload.age_confirmed = !!ageOk.checked;
    }
    showTyping();
    fetch(API_MSG, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().then(function (json) { return { ok: res.ok, json: json }; });
      })
      .then(function (r) {
        // QUIRK: reproduced deliberately (TW-WGT-009 rule 2). A refused message (403, 422, 429) shows nothing: the visitor's
        // bubble stays and the message was never stored.
        var json = r.json;
        if (!r.ok && json && json.code === 'age_blocked') { blockChat(true); return; }
        if (!r.ok && json && json.errors && json.errors.age) { reopenIntake(); return; }
        if (json.reply && json.reply.body) {
          addBubble('in', json.reply.body, { id: json.reply.id, at: json.reply.at });
          lastSeenMsgId = Math.max(lastSeenMsgId, json.reply.id || 0);
        }
        // A flow bot answers through the poll: look often for a little while after the visitor writes.
        burstPoll();
      })
      .catch(function () {
        hideTyping();
        addBubble('in', tx('failed', "Sorry, that didn't go through. Please try again."));
      })
  }

  // The visitor attaches a file to answer a question that asked for one: it is checked again on the server.
  function upload(file) {
    var att = document.querySelector('.att');
    if (!file || PREVIEW) return;
    if (file.size > 10 * 1024 * 1024) { addBubble('in', tx('tooBig', 'That file is too big. Please send one under 10 MB.'), { input: hint }); return; }
    visitorSpeaks();
    att.classList.add('busy');
    addBubble('out', '\\uD83D\\uDCCE ' + file.name);
    var fd = new FormData();
    fd.append('file', file);
    fetch(withVid(API_UP), { method: 'POST', credentials: 'include', body: fd })
      .then(function (res) { return res.json().then(function (json) { return { ok: res.ok, json: json }; }); })
      .then(function (r) {
        att.classList.remove('busy');
        if (!r.ok) addBubble('in', (r.json && r.json.message) || tx('cannotSend', 'That file cannot be sent.'), { input: hint });
        else { showTyping(); burstPoll(); }
      })
      .catch(function () {
        att.classList.remove('busy');
        addBubble('in', tx('failed', "Sorry, that didn't go through. Please try again."), { input: hint });
      });
  }
  $('file').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; upload(f); });
  $('send').addEventListener('click', function () { send(); setTimeout(syncSend, 0); });
  $('txt').addEventListener('keydown', function (e) { if (e.key === 'Enter') { send(); setTimeout(syncSend, 0); } });
  $('txt').addEventListener('input', syncSend);

  // Replies a person typed in the team inbox arrive here: every business message not drawn yet is shown once.
  // It asks every 4 seconds while something is happening and backs off (8, 16, 32, 60 s) while nothing new arrives; it stops while the tab is hidden.
  var POLL_BASE_MS = 4000, POLL_MAX_MS = 60000, pollMs = POLL_BASE_MS, pollTimer = null;
  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = document.hidden ? null : setTimeout(poll, pollMs);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { pollMs = POLL_BASE_MS; poll(); } else schedulePoll(); });
  function poll() {
    if (PREVIEW) return;
    fetch(withVid(API_HIS + '?since=' + lastSeenMsgId), { credentials: 'include' })
      .then(function (res) { return res.ok ? res.json() : { messages: [] }; })
      .then(function (json) {
        var list = json.messages || [];
        pollMs = list.length ? POLL_BASE_MS : Math.min(pollMs * 2, POLL_MAX_MS);
        list.forEach(function (m, i) {
          if (!document.querySelector('[data-id="' + m.id + '"]')) addBubble('in', m.body || '', { id: m.id, at: m.at, cards: m.cards, links: m.links, media: m.media, input: i === list.length - 1 ? m.input : null, buttons: i === list.length - 1 ? m.buttons : null });
          if (m.id > lastSeenMsgId) lastSeenMsgId = m.id;
        });
      })
      .catch(function () { pollMs = Math.min(pollMs * 2, POLL_MAX_MS); })
      .then(schedulePoll);
  }
  $('msgs').addEventListener('scroll', function () { $('latest').style.display = nearBottom() ? 'none' : 'flex'; }, { passive: true });
  $('latest').addEventListener('click', toBottom);
  $('mic').addEventListener('click', startVoice);
  $('vend').addEventListener('click', stopVoice);
  $('vtype').addEventListener('click', function () { stopVoice(); $('txt').focus(); });
  schedulePoll();
  var burstTimer = null;
  function burstPoll() {
    if (burstTimer) clearInterval(burstTimer);
    pollMs = POLL_BASE_MS;
    var left = 20;
    burstTimer = setInterval(function () {
      poll();
      left -= 1;
      if (left <= 0) { clearInterval(burstTimer); burstTimer = null; }
    }, 1000);
  }

  // The words that sit in the page itself.
  (function applyText() {
    $('txt').placeholder = tx('typeMessage', 'Type a message\\u2026');
    $('txt').setAttribute('aria-label', tx('typeMessage', 'Type a message\\u2026'));
    document.querySelector('.hint').textContent = tx('enterHint', 'Press Enter to send');
    document.querySelector('.att span:last-child').textContent = tx('attach', 'Attach a file');
    $('msgs').setAttribute('aria-label', tx('conversation', 'Conversation'));
    $('latest').setAttribute('aria-label', tx('latestAria', 'Jump to the latest message'));
    $('latest').lastChild.textContent = tx('latest', 'Latest');
    $('mic').setAttribute('aria-label', tx('voiceOn', 'Talk instead'));
    $('vend').textContent = tx('voiceEnd', 'End');
    $('vtype').textContent = tx('voiceTypeInstead', 'Type instead');
  })();

  // The Customize preview: the same window, painted from what the page that frames it sends (the author's unsaved settings), with a
  // short sample conversation, so every colour, shape and option can be judged before it is saved.
  function previewMode() {
    $('send').disabled = true;
    document.body.dataset.preview = '1';
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || !d.wgtPreview || !d.wgtPreview.widget) return;
      cfg = d.wgtPreview.widget;
      visitorSpoke = false;
      hideTyping();
      clearChips();
      $('msgs').textContent = '';
      paintChrome();
      renderSuggestions();
      addBubble('in', cfg.welcome_message || '', { noTime: true });
      addBubble('out', '\\uD83D\\uDC4B', { noTime: true });
      addBubble('in', cfg.welcome_message || '', { noTime: true, id: 1, buttons: [{ id: 'a', title: tx('continue', 'Continue') }, { id: 'b', title: tx('open', 'Open') }] });
      toBottom();
    });
    try { window.parent.postMessage({ wgt: 'preview-ready' }, '*'); } catch (err) {}
  }

  if (PREVIEW) previewMode(); else loadConfig();
})();
`;

export function renderChatPage(w: ChatPageWidget): string {
  const locale = w.locale && CHAT_TEXT[w.locale] ? w.locale : 'en';
  const script = SCRIPT.replace('__TOKEN__', () => jsString(w.token))
    .replace('__FLOW__', w.flow ? 'true' : 'false')
    .replace('__PREVIEW__', w.preview ? 'true' : 'false')
    .replace('__SIZES__', () => JSON.stringify(CHAT_SIZE_PX))
    .replace('__TEXT__', () =>
      JSON.stringify(CHAT_TEXT[locale])
        .replace(/</g, '\\u003c')
        .replace(/\u2028|\u2029/g, ' '),
    )
    .replace('__COUNTRIES__', () =>
      JSON.stringify(flbPhoneCountries(locale))
        .replace(/</g, '\\u003c')
        .replace(/\u2028|\u2029/g, ' '),
    );
  return `<!doctype html>
<html lang="${locale}" dir="${RTL_LOCALES.has(locale) ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(w.name)}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="header" id="hdr"></header>
<div class="pop" id="menupop" hidden role="menu"></div>
<div class="modal" id="endmodal" hidden></div>
<div class="pop" id="noticepop" hidden></div>
<div class="banner" id="banner" hidden></div>
<div class="stage">
<div class="body" id="msgs" role="log" aria-live="polite" aria-label="Conversation"></div>
<div class="voice" id="voice" hidden role="dialog" aria-live="polite"><div class="orb"><b></b><i></i></div><div class="vphase" id="vphase"></div><div class="vline" id="vline"></div><div class="vbtns"><button type="button" id="vtype"></button><button type="button" class="end" id="vend"></button></div></div>
<button class="latest" id="latest" type="button" aria-label="Jump to the latest message"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v14M6 13l6 6 6-6"></path></svg>Latest</button>
</div>
<div class="pipcard" id="pipcard" hidden></div>
<footer class="footer">
<div class="sugg" id="sugg" hidden></div>
<div id="intake" class="intake" style="display:none"></div>
<div class="dp" id="dp" hidden role="dialog"></div>
<div class="input-row">
<select id="cc" class="cc" hidden></select>
<button id="locbtn" class="locbtn" type="button">Share my location</button>
<input id="txt" type="text" placeholder="Type a message…" aria-label="Type a message" autocomplete="off" />
<button class="dpbtn" id="dpbtn" type="button" hidden aria-haspopup="dialog"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3"></rect><path d="M8 3v4M16 3v4M3.5 10h17"></path></svg></button>
<label class="att" id="att"><input id="file" type="file" hidden /><span aria-hidden="true">&#128206;</span><span>Attach a file</span></label>
<button class="mic" id="mic" type="button" hidden><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path></svg></button>
<button id="send" type="button" disabled></button>
</div>
<div class="hint">Press Enter to send</div>
</footer>
<script>${script}</script>
</body>
</html>
`;
}
