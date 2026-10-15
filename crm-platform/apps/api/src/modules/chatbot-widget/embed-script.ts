import {
  buildLauncherScript,
  CHAT_SIZE_PX,
  launcherAvatarSrc,
  type WidgetLauncher,
} from '@crm/contracts';

/**
 * The loader a site pastes as `<script defer src=".../widget/<token>/embed">` (TW-WGT-008): it injects the floating
 * launcher and a hidden panel holding an iframe of the chat page.
 *
 * Values are put into the script as JSON string literals and into the DOM through properties, never through markup, so a
 * saved colour or image address cannot break out of the script or the element.
 */

export interface EmbedWidget {
  uuid: string;
  /** `whatsapp` widgets draw the messenger panel themselves (TW-WGT-028); `ai` and `both` open the chat page in a frame. */
  mode: string;
  name: string;
  launcher: WidgetLauncher;
  /** The `wa.me` link of the widget, or null when it has no number. */
  whatsappUrl: string | null;
  position: string;
  buttonColor: string;
  buttonImageUrl: string | null;
  autoOpen: boolean;
  /** A flow bot's widget (a website chat bot): it gets the larger, softer panel. The AI chat widget keeps its original size. */
  flow?: boolean;
}

const COLOUR = /^[#a-zA-Z0-9(),.%\s-]{1,16}$/;
export const DEFAULT_BUTTON_COLOUR = '#075E54';

/** A colour that is safe inside a style attribute; anything else falls back to the default. */
export const safeColour = (value: string | null | undefined, fallback: string): string =>
  value && COLOUR.test(value) ? value : fallback;

/** Only an absolute http(s) address can be an image; anything else (a `javascript:` URL, junk) is dropped. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** A string as a JavaScript literal that is also safe inside an inline `<script>` element. */
export const jsString = (value: string): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');

const CHAT_GLYPH =
  "<svg viewBox='0 0 24 24' width='28' height='28' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z'/></svg>";

/**
 * The closed launcher of a website chat bot: the callout the author chose (a bubble above, a pill beside, a pill with an avatar, a card
 * with a picture, or a bar that looks like the chat's input), the bounce or ripple, and the unread dot. Everything the author typed goes
 * in with `textContent` and the picture with `src`; the callout opens the chat, its cross dismisses it, and opening the chat hides
 * all of it. Runs inside the loader, so it uses the loader's `d`, `wrap`, `btn`, `panel`, `side` and `toggle`.
 */
function calloutScript(w: EmbedWidget, colour: string, side: string): string {
  const l = w.launcher;
  const cfg = {
    on: l.popup.enabled && l.popup.text !== '',
    style: l.popup.style,
    text: l.popup.text,
    image: l.popup.image === '' ? '' : launcherAvatarSrc(l.popup.image),
    animation: l.animation,
    badge: l.badge,
    colour,
    side,
  };
  const seen = `wgt-callout-${w.uuid}`;
  return `
  // The closed launcher's callout, animation and unread dot.
  var X = JSON.parse(${jsString(JSON.stringify(cfg))});
  var extras = [];
  function hideExtras() { extras.forEach(function (e) { e.style.display = 'none'; }); }
  (function () {
    var css = '';
    if (X.animation === 'bounce') css += '@keyframes wgtBounce{0%,60%,100%{transform:none}20%{transform:translateY(-12px)}40%{transform:translateY(-5px)}}';
    if (X.animation === 'ripple') css += '@keyframes wgtRipple{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--wgt-c) 45%,transparent)}100%{box-shadow:0 0 0 18px color-mix(in srgb,var(--wgt-c) 0%,transparent)}}';
    css += '@media (prefers-reduced-motion:reduce){#' + btn.id + '{animation:none!important}}';
    var sx = d.createElement('style');
    sx.textContent = css;
    d.head.appendChild(sx);
    btn.style.setProperty('--wgt-c', X.colour);
    if (X.animation === 'bounce') btn.style.animation = 'wgtBounce 1.8s ease infinite';
    if (X.animation === 'ripple') btn.style.animation = 'wgtRipple 1.8s ease-out infinite';
    btn.style.position = 'relative';
    if (X.badge) {
      var dot = d.createElement('span');
      dot.textContent = '1';
      dot.style.cssText = 'position:absolute;top:-3px;' + (X.side === 'left' ? 'left' : 'right') + ':-3px;min-width:20px;height:20px;border-radius:999px;background:#ff4d5e;color:#fff;font:700 11px system-ui,sans-serif;display:grid;place-items:center;border:2px solid #fff';
      btn.appendChild(dot);
      extras.push(dot);
    }
    if (!X.on) return;
    var dismissed = false;
    try { dismissed = sessionStorage.getItem(${jsString(seen)}) === '1'; } catch (e) {}
    if (dismissed) return;
    var box = d.createElement('div');
    var style = X.style;
    var base = 'position:absolute;box-sizing:border-box;background:#fff;color:#20222e;box-shadow:0 8px 26px rgba(24,26,54,.18);cursor:pointer;font:14.5px/1.4 system-ui,-apple-system,sans-serif;display:flex;';
    var edge = X.side === 'left' ? 'left' : 'right';
    var near = X.side === 'left' ? 'left:70px' : 'right:70px';
    function closeBtn() {
      var c = d.createElement('button');
      c.type = 'button';
      c.setAttribute('aria-label', 'Dismiss message');
      c.textContent = '\\u00d7';
      c.style.cssText = 'flex:none;width:20px;height:20px;border:0;border-radius:50%;background:#f1f2f8;color:#7a7e96;font:700 14px/1 system-ui;cursor:pointer;padding:0';
      c.addEventListener('click', function (ev) {
        ev.stopPropagation();
        hideExtras();
        try { sessionStorage.setItem(${jsString(seen)}, '1'); } catch (e) {}
      });
      return c;
    }
    function avatar() {
      var a = d.createElement('span');
      a.style.cssText = 'flex:none;width:32px;height:32px;border-radius:50%;background:#ece9fb;color:' + X.colour + ';display:grid;place-items:center;overflow:hidden';
      if (X.image) {
        var im = d.createElement('img');
        im.src = X.image;
        im.alt = '';
        im.style.cssText = 'width:100%;height:100%;object-fit:cover';
        a.appendChild(im);
      } else a.textContent = '\\u263a';
      return a;
    }
    var label = d.createElement('span');
    label.textContent = X.text;
    label.style.cssText = 'flex:1;min-width:0;overflow-wrap:anywhere';
    if (style === 'media') {
      box.style.cssText = base + 'bottom:70px;' + edge + ':0;width:290px;max-width:calc(100vw - 48px);flex-direction:column;gap:10px;padding:14px;border-radius:16px';
      var head = d.createElement('div');
      head.style.cssText = 'display:flex;align-items:center;gap:9px';
      head.appendChild(avatar());
      head.appendChild(label);
      head.appendChild(closeBtn());
      box.appendChild(head);
      if (X.image) {
        var pic = d.createElement('img');
        pic.src = X.image;
        pic.alt = '';
        pic.style.cssText = 'width:100%;height:140px;object-fit:cover;border-radius:10px';
        box.appendChild(pic);
      }
    } else if (style === 'bar') {
      box.style.cssText = base + 'bottom:8px;' + near + ';align-items:center;gap:12px;width:max-content;min-width:230px;max-width:calc(100vw - 110px);padding:9px 9px 9px 18px;border-radius:999px';
      box.appendChild(label);
      var up = d.createElement('span');
      up.textContent = '\\u2191';
      up.style.cssText = 'flex:none;width:32px;height:32px;border-radius:50%;background:#eceef6;color:#5b5e75;display:grid;place-items:center;font-weight:700';
      box.appendChild(up);
    } else if (style === 'pill' || style === 'avatar') {
      box.style.cssText = base + 'bottom:10px;' + near + ';align-items:center;gap:10px;width:max-content;max-width:min(260px,calc(100vw - 110px));padding:9px 12px 9px 14px;border-radius:999px';
      if (style === 'avatar') box.appendChild(avatar());
      box.appendChild(label);
      box.appendChild(closeBtn());
    } else {
      box.style.cssText = base + 'bottom:72px;' + edge + ':0;width:max-content;max-width:min(290px,calc(100vw - 48px));align-items:flex-start;gap:8px;padding:14px 12px 14px 18px;border-radius:18px';
      box.appendChild(label);
      box.appendChild(closeBtn());
    }
    box.addEventListener('click', function () { if (panel.style.display === 'none') toggle(); });
    wrap.appendChild(box);
    extras.push(box);
  })();
`;
}

/**
 * The floating chat window (Document Picture-in-Picture, the way a video call keeps a small window over other tabs and apps). It lives
 * here, in the page, because a browser only offers the API to the top-level page and only on a visitor's click. The chat window (a
 * frame) asks through messages: a click on its float button opens the window and moves the chat into it; when the visitor has written
 * and then leaves the tab, a system notification offers to continue (if they allowed notifications), and a click on it brings them back
 * with the offer ready. Browsers without the API never see the button.
 */
const PIP_SCRIPT = `
  var PIP = 'documentPictureInPicture' in window;
  var pipWin = null, pipText = { title: '', body: '' }, talked = false;
  function tell(m) { try { frame.contentWindow.postMessage(m, '*'); } catch (e) {} }
  function pipState() { tell({ wgt: 'pip-state', supported: PIP, active: !!pipWin }); }
  function closePip() { if (pipWin) { try { pipWin.close(); } catch (e) {} } }
  function openPip() {
    if (!PIP || pipWin) return Promise.resolve();
    return window.documentPictureInPicture.requestWindow({ width: 380, height: 560 }).then(function (w) {
      pipWin = w;
      w.document.documentElement.style.height = '100%';
      w.document.body.style.cssText = 'margin:0;height:100%';
      frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
      w.document.body.appendChild(frame);
      panel.style.display = 'none';
      w.addEventListener('pagehide', function () {
        pipWin = null;
        frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
        panel.appendChild(frame);
      });
    }).catch(function () {});
  }
  window.addEventListener('message', function (e) {
    if (e.source !== frame.contentWindow || !e.data) return;
    var m = e.data.wgt;
    if (m === 'hello') pipState();
    else if (m === 'pip-text') pipText = { title: String(e.data.title || ''), body: String(e.data.body || '') };
    else if (m === 'pip') { if (pipWin) closePip(); else openPip(); }
    else if (m === 'activity' && PIP) {
      talked = true;
      var asked = false;
      try { asked = window.sessionStorage.getItem('wgt_pip_asked') === '1'; } catch (err) {}
      if (!asked && window.Notification && Notification.permission === 'default') {
        try { window.sessionStorage.setItem('wgt_pip_asked', '1'); } catch (err) {}
        tell({ wgt: 'pip-ask' });
      }
    } else if (m === 'ask-notify' && window.Notification) {
      try { Notification.requestPermission(); } catch (err) {}
    }
  });
  if (PIP) {
    // Offered when the visitor has written and then switches to another tab or window.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'hidden' || !talked || pipWin) return;
      if (window.Notification && Notification.permission === 'granted') {
        try {
          var n = new Notification(pipText.title || document.title, { body: pipText.body, tag: 'wgt-pip' });
          n.onclick = function () {
            window.focus();
            n.close();
            panel.style.display = 'block';
            openPip().then(function () { if (!pipWin) tell({ wgt: 'pip-offer' }); });
          };
        } catch (err) {}
      }
    });
    // Some browsers float a tab by themselves when its page offers it (as video calls do).
    try { navigator.mediaSession.setActionHandler('enterpictureinpicture', function () { openPip(); }); } catch (err) {}
  }
`;

export function buildEmbedScript(w: EmbedWidget, chatUrl: string): string {
  if (w.mode === 'whatsapp') {
    // User-requested Interakt reference: the launcher opens a messenger panel whose button opens WhatsApp (TW-WGT-028).
    return buildLauncherScript({
      id: w.uuid,
      name: w.name,
      launcher: w.launcher,
      whatsappUrl: w.whatsappUrl,
      autoOpen: w.autoOpen,
    });
  }
  const side = w.position === 'bottom_left' ? 'left' : 'right';
  const colour = safeColour(w.buttonColor, DEFAULT_BUTTON_COLOUR);
  const image = safeHttpUrl(w.buttonImageUrl);
  const short = w.uuid.replace(/-/g, '').slice(0, 12);
  const rich = w.flow === true;
  const size = CHAT_SIZE_PX[w.launcher.chat.size];
  return `(function () {
  var GUARD = ${jsString(`__wgtWidget_${w.uuid}`)};
  if (window[GUARD]) return;
  window[GUARD] = true;

  var d = document;
  var side = ${jsString(side)};
  var wrap = d.createElement('div');
  wrap.style.cssText = 'position:fixed;bottom:24px;' + side + ':24px;z-index:2147483600;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
${
  rich
    ? `  // Where the launcher sits is the author's: a gap from the screen's side and bottom, one for a desktop and one for a phone.
  var PLACE = { d: { s: ${w.launcher.desktop.sideSpacing}, b: ${w.launcher.desktop.bottomSpacing} }, m: { s: ${w.launcher.mobile.sideSpacing}, b: ${w.launcher.mobile.bottomSpacing} } };
  var DEVICES = ${JSON.stringify(w.launcher.chat.devices)};
  function place() {
    // The author may keep the widget off some devices: a phone is up to 768 px, a tablet up to 1024 px.
    var vw = window.innerWidth;
    var kind = vw <= 768 ? 'mobile' : vw <= 1024 ? 'tablet' : 'desktop';
    wrap.style.display = DEVICES[kind] === false ? 'none' : '';
    var p = window.matchMedia && window.matchMedia('(max-width:768px)').matches ? PLACE.m : PLACE.d;
    wrap.style.bottom = p.b + 'px';
    wrap.style.left = side === 'left' ? p.s + 'px' : 'auto';
    wrap.style.right = side === 'right' ? p.s + 'px' : 'auto';
    if (typeof panel !== 'undefined') {
      panel.style.bottom = (p.b + 74) + 'px';
      panel.style.left = side === 'left' ? p.s + 'px' : 'auto';
      panel.style.right = side === 'right' ? p.s + 'px' : 'auto';
    }
  }
`
    : ''
}
  var btn = d.createElement('button');
  btn.id = ${jsString(`wgt-launch-${short}`)};
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Open chat');
${
  rich
    ? `  btn.style.cssText = 'width:58px;height:58px;border-radius:9999px;border:0;box-shadow:0 8px 24px rgba(24,26,54,.28);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:transform .15s';
  btn.addEventListener('mouseenter', function () { btn.style.transform = 'scale(1.06)'; });
  btn.addEventListener('mouseleave', function () { btn.style.transform = ''; });`
    : `  btn.style.cssText = 'width:56px;height:56px;border-radius:9999px;border:0;box-shadow:0 6px 24px rgba(0,0,0,.18);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;';`
}
  btn.style.background = ${jsString(colour)};
${
  image
    ? `  var img = d.createElement('img');
  img.src = ${jsString(image)};
  img.alt = '';
  img.style.cssText = 'width:36px;height:36px;border-radius:50%';
  btn.appendChild(img);`
    : `  btn.innerHTML = ${jsString(CHAT_GLYPH)};`
}

  var panel_id = ${jsString(`wgt-panel-${short}`)};
  var panel = d.createElement('div');
  panel.id = panel_id;
${
  rich
    ? `  var st = d.createElement('style');
  st.textContent = '@keyframes wgtIn{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){#' + panel_id + '{animation:none!important}}';
  d.head.appendChild(st);
  panel.style.cssText = 'display:none;position:fixed;bottom:98px;' + side + ':24px;width:${size.w}px;height:${size.h}px;max-width:calc(100vw - 32px);max-height:calc(100vh - 124px);border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(24,26,54,.24);background:#fff';`
    : `  panel.style.cssText = 'display:none;position:fixed;bottom:96px;' + side + ':24px;width:380px;height:560px;max-width:calc(100vw - 32px);max-height:calc(100vh - 120px);border-radius:14px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.25);background:#fff';`
}
${rich ? "  place();\n  window.addEventListener('resize', place);\n" : ''}  var frame = d.createElement('iframe');
  frame.src = ${jsString(chatUrl)};
  frame.title = 'Chat';
  frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
${
  rich
    ? `  // The window may copy to the clipboard and, when the author turned voice on, listen.
  frame.setAttribute('allow', 'clipboard-write; microphone');
`
    : ''
}  panel.appendChild(frame);

  wrap.appendChild(btn);
  wrap.appendChild(panel);
  d.body.appendChild(wrap);

${
  rich
    ? `  function toggle() {
    var opening = panel.style.display === 'none';
    panel.style.display = opening ? 'block' : 'none';
    if (opening) {
      panel.style.animation = 'wgtIn .22s cubic-bezier(.2,.7,.3,1) both';
      hideExtras();
    }
  }
  // The chat window's own close button asks the page to hide the panel.
  window.addEventListener('message', function (e) {
    if (e.source !== frame.contentWindow || !e.data) return;
    if (e.data.wgt === 'close') panel.style.display = 'none';
    if (e.data.wgt === 'expand') {
      var big = e.data.on === true;
      panel.style.width = big ? 'min(880px,calc(100vw - 32px))' : '${size.w}px';
      panel.style.height = big ? 'min(720px,calc(100vh - 124px))' : '${size.h}px';
    }
  });
${w.launcher.chat.pip ? PIP_SCRIPT : ''}`
    : `  function toggle() { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; }`
}
${rich ? calloutScript(w, colour, side) : ''}  btn.addEventListener('click', toggle);
${w.autoOpen && !rich ? '  setTimeout(toggle, 1200);\n' : ''}${
    rich && w.launcher.chat.autoOpen > 0
      ? `  // The window opens by itself after the author's delay, once per visit, and never after the visitor has opened or closed it.
  var OPENED = ${jsString(`wgt_ao_${w.uuid}`)};
  function seen() { try { return window.sessionStorage.getItem(OPENED) === '1'; } catch (e) { return false; } }
  function mark() { try { window.sessionStorage.setItem(OPENED, '1'); } catch (e) {} }
  btn.addEventListener('click', mark);
  setTimeout(function () { if (!seen() && panel.style.display === 'none') { mark(); toggle(); } }, ${w.launcher.chat.autoOpen * 1000});
`
      : ''
  }})();
`;
}

export const NOT_FOUND_SCRIPT = '// chatbot widget not found or paused\n';
