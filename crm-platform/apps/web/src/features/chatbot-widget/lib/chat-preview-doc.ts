import { launcherImageUrl } from '@crm/contracts';
import type { BuilderState } from './builder-model';

const COLOUR = /^[#a-zA-Z0-9(),.%\s-]{1,16}$/;
/** A colour that is safe in a style property; anything else falls back (the chat page does the same check). */
export const safePreviewColour = (v: string, fallback: string): string =>
  COLOUR.test(v) ? v : fallback;

/** Everything the chat panel preview draws, taken from the wizard's fields (all strings already safe to hand to a style). */
export interface ChatPreviewInput {
  mode: 'ai' | 'both';
  headerTitle: string;
  headerBg: string;
  headerText: string;
  welcome: string;
  bubbleColor: string;
  bubbleText: string;
  bodyKind: 'color' | 'image';
  bodyColor: string;
  bodyImage: string | null;
  buttonLabel: string;
  buttonBg: string;
  buttonText: string;
  collect: { name: boolean; email: boolean; phone: boolean };
  /** `both` shows the "Open WhatsApp" action under the opening bubble, as the chat page does once a number is set. */
  whatsapp: boolean;
  side: 'left' | 'right';
  launcherColour: string;
  launcherImage: string | null;
  device: 'desktop' | 'mobile';
  startOpen: boolean;
  /** Fallbacks for an empty field, in the builder's language. */
  text: { title: string; welcome: string; send: string };
}

export function chatPreviewInput(
  s: BuilderState,
  device: 'desktop' | 'mobile',
  startOpen: boolean,
  text: ChatPreviewInput['text'],
): ChatPreviewInput {
  const digits = `${s.targetWhatsappCc}${s.targetWhatsappNumber}`.replace(/\D+/g, '');
  return {
    mode: s.mode === 'both' ? 'both' : 'ai',
    headerTitle: s.headerTitle.trim() || text.title,
    headerBg: safePreviewColour(s.headerBg, '#075E54'),
    headerText: safePreviewColour(s.headerTextColor, '#FFFFFF'),
    welcome: s.welcomeMessage.trim() || text.welcome,
    bubbleColor: safePreviewColour(s.messageBubbleColor, '#FFFFFF'),
    bubbleText: safePreviewColour(s.messageTextColor, '#222222'),
    bodyKind: s.bodyBgKind,
    bodyColor: safePreviewColour(s.bodyBgColor, '#ECE5DD'),
    bodyImage: s.bodyBgKind === 'image' ? launcherImageUrl(s.bodyBgImageUrl) : null,
    buttonLabel: s.buttonLabel.trim() || text.send,
    buttonBg: safePreviewColour(s.actionButtonBg, '#075E54'),
    buttonText: safePreviewColour(s.actionButtonTextColor, '#FFFFFF'),
    collect: { name: s.collectName, email: s.collectEmail, phone: s.collectPhone },
    whatsapp: s.mode === 'both' && digits.length >= 8,
    side: s.position === 'bottom_left' ? 'left' : 'right',
    launcherColour: safePreviewColour(s.buttonColor, '#075E54'),
    launcherImage: launcherImageUrl(s.buttonImageUrl),
    device,
    startOpen,
    text,
  };
}

const literal = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');

// A fixed program that reads a data object; every value reaches the page through a property, never through markup.
const RUNTIME = `
(function (C) {
  var d = document;
  function el(tag, css, text) { var n = d.createElement(tag); if (css) n.style.cssText = css; if (text) n.textContent = text; return n; }
  function svg(markup, size) { var s = el('span', 'display:inline-flex;width:' + size + 'px;height:' + size + 'px;flex:none'); s.innerHTML = markup; return s; }
  var CHAT = "<svg viewBox='0 0 24 24' width='100%' height='100%' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l1.9-5.6A8.4 8.4 0 1 1 21 11.5z'/></svg>";
  var DOWN = "<svg viewBox='0 0 24 24' width='100%' height='100%' fill='none' stroke='#fff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>";
  var style = el('style');
  style.textContent = '.pv{position:fixed;bottom:16px;display:flex;flex-direction:column;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.35}.pv *{box-sizing:border-box}';
  d.head.appendChild(style);
  var wrap = el('div', C.side === 'left' ? 'left:16px;align-items:flex-start' : 'right:16px;align-items:flex-end');
  wrap.className = 'pv';
  wrap.setAttribute('data-testid', 'wgt-embed');
  wrap.setAttribute('data-dev', C.device === 'mobile' ? 'm' : 'd');

  var panel = el('div', 'display:none;flex-direction:column;width:380px;max-width:calc(100vw - 32px);height:min(560px,calc(100vh - 100px));min-height:260px;margin-bottom:12px;border-radius:20px;overflow:hidden;background:#fff;box-shadow:0 14px 48px rgba(0,0,0,.28)');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', C.headerTitle);

  var head = el('div', 'display:flex;align-items:center;gap:14px;padding:16px 18px;flex:none;background:' + C.headerBg + ';color:' + C.headerText);
  head.setAttribute('data-testid', 'preview-header');
  var avatar = el('span', 'width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none;background:rgba(255,255,255,.2);border:2px solid rgba(255,255,255,.85);overflow:hidden');
  if (C.launcherImage) { var im = el('img', 'width:100%;height:100%;object-fit:cover'); im.alt = ''; im.src = C.launcherImage; avatar.appendChild(im); }
  else avatar.appendChild(svg(CHAT, 26));
  var who = el('div', 'min-width:0');
  who.appendChild(el('div', 'font-size:17px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', C.headerTitle));
  who.appendChild(el('div', 'font-size:12.5px;font-weight:700;margin-top:3px;opacity:.95', 'Typically replies within 5 mins'));
  head.appendChild(avatar);
  head.appendChild(who);

  var body = el('div', 'flex:1;overflow:auto;padding:18px 16px;display:flex;flex-direction:column;gap:10px;background-color:' + C.bodyColor);
  if (C.bodyImage) { body.style.backgroundImage = 'url("' + C.bodyImage.replace(/["()\\\\\\s]/g, function (ch) { return '%' + ch.charCodeAt(0).toString(16).toUpperCase(); }) + '")'; body.style.backgroundSize = 'cover'; }
  var bubble = el('div', 'position:relative;align-self:flex-start;max-width:86%;border-radius:0 12px 12px 12px;padding:9px 12px 22px;font-size:14px;box-shadow:0 1px 1px rgba(0,0,0,.13);overflow-wrap:anywhere;white-space:pre-wrap;background:' + C.bubbleColor + ';color:' + C.bubbleText);
  bubble.setAttribute('data-testid', 'preview-welcome');
  bubble.appendChild(el('span', 'position:absolute;left:-7px;top:0;width:0;height:0;border-top:9px solid ' + C.bubbleColor + ';border-left:8px solid transparent'));
  bubble.appendChild(el('div', '', C.welcome));
  var time = el('span', 'position:absolute;right:10px;bottom:5px;font-size:11px;opacity:.6');
  try { time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); } catch (e) { time.textContent = ''; }
  bubble.appendChild(time);
  body.appendChild(bubble);
  if (C.whatsapp) body.appendChild(el('div', 'align-self:stretch;text-align:center;padding:9px 12px;border-radius:10px;background:#25D366;color:#fff;font-weight:600;font-size:13px', 'Open WhatsApp'));

  var foot = el('div', 'flex:none;padding:12px;border-top:1px solid #e5e7eb;background:#fff');
  var any = C.collect.name || C.collect.email || C.collect.phone;
  if (any) {
    var intake = el('div', 'background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin-bottom:8px');
    intake.setAttribute('data-testid', 'preview-intake');
    intake.appendChild(el('div', 'font-size:12px;color:#374151;margin-bottom:6px;font-weight:600', 'Tell us a bit about you'));
    [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone']].forEach(function (f) {
      if (!C.collect[f[0]]) return;
      intake.appendChild(el('div', 'font-size:11px;color:#6b7280;margin-bottom:3px', f[1]));
      intake.appendChild(el('div', 'height:28px;border:1px solid #d1d5db;border-radius:6px;margin-bottom:6px;background:#fff'));
    });
    intake.appendChild(el('div', 'text-align:center;padding:7px;background:#075E54;color:#fff;border-radius:6px;font-weight:600;font-size:12.5px', 'Continue'));
    foot.appendChild(intake);
  }
  var row = el('div', 'display:flex;gap:8px');
  row.appendChild(el('div', 'flex:1;padding:9px 14px;border:1px solid #d1d5db;border-radius:20px;font-size:13px;color:#9ca3af', 'Type a message\\u2026'));
  var send = el('button', 'padding:0 18px;border:0;border-radius:20px;font-weight:600;font-size:12.5px;cursor:default;background:' + C.buttonBg + ';color:' + C.buttonText + (any ? ';opacity:.5' : ''), C.buttonLabel);
  send.type = 'button';
  send.tabIndex = -1;
  send.setAttribute('data-testid', 'preview-button');
  row.appendChild(send);
  foot.appendChild(row);

  panel.appendChild(head);
  panel.appendChild(body);
  panel.appendChild(foot);

  var launch = el('button', 'border:0;cursor:pointer;width:60px;height:60px;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;overflow:hidden;box-shadow:0 8px 26px rgba(0,0,0,.25);background:' + C.launcherColour);
  launch.type = 'button';
  launch.setAttribute('data-testid', 'wgt-launcher');
  launch.setAttribute('aria-label', 'Open chat');
  if (C.launcherImage) { var li = el('img', 'width:36px;height:36px;border-radius:50%'); li.alt = ''; li.src = C.launcherImage; launch.appendChild(li); }
  else launch.appendChild(svg(CHAT, 28));
  var close = el('button', 'display:none;border:0;cursor:pointer;width:50px;height:50px;padding:0;border-radius:50%;align-items:center;justify-content:center;box-shadow:0 8px 26px rgba(0,0,0,.25);background:' + C.launcherColour);
  close.type = 'button';
  close.setAttribute('data-testid', 'wgt-close');
  close.setAttribute('aria-label', 'Close chat');
  close.appendChild(svg(DOWN, 26));

  wrap.appendChild(panel);
  wrap.appendChild(launch);
  wrap.appendChild(close);
  d.body.appendChild(wrap);

  function show(open) {
    panel.style.display = open ? 'flex' : 'none';
    launch.style.display = open ? 'none' : 'flex';
    close.style.display = open ? 'flex' : 'none';
    if (window.parent && window.parent !== window) window.parent.postMessage({ wgt: 'toggle', open: open }, '*');
  }
  launch.addEventListener('click', function () { show(true); });
  close.addEventListener('click', function () { show(false); });
  if (C.startOpen) { panel.style.display = 'flex'; launch.style.display = 'none'; close.style.display = 'flex'; }
})
`;

/**
 * The page the builder's live preview shows for the Smart agent and Smart + WhatsApp engines: the same open messenger
 * panel as the WhatsApp page (tall, header with image, name and reply time, one bubble, a footer), drawn from the wizard's
 * fields. It is a picture of the settings: the real AI widget is the framed chat page, which this does not load.
 */
export function chatPreviewDocument(i: ChatPreviewInput): string {
  const script = `${RUNTIME.trim()}(${literal(i)});`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;height:100%;background:linear-gradient(180deg,#f7f7f8,#ececef);font-family:system-ui,sans-serif;overflow:hidden}
  .bar{display:flex;align-items:center;gap:6px;padding:9px 14px;background:rgba(255,255,255,.7);border-bottom:1px solid #e2e2e6}
  .dot{width:8px;height:8px;border-radius:50%;background:#d4d4d8}
  .url{flex:1;height:12px;margin-left:10px;border-radius:6px;background:#e4e4e8}
</style></head>
<body>
  <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="url"></span></div>
  <script>${script}</script>
</body></html>`;
}
