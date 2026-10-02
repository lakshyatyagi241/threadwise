import { jsString } from './embed-script';

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
}

const STYLE = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; height: 100%; }
body { display: flex; flex-direction: column; background: #fff; }
.header { height: 56px; display: flex; align-items: center; padding: 0 16px; font-weight: 600; font-size: 14px; flex: none; }
.body { flex: 1; padding: 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.bubble { max-width: 78%; padding: 8px 12px; border-radius: 14px; font-size: 13.5px; line-height: 1.4; word-wrap: break-word; white-space: pre-wrap; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
.bubble.in { align-self: flex-start; }
.bubble.out { align-self: flex-end; background: #DCF8C6; color: #1f2937; }
.typing { align-self: flex-start; font-size: 11.5px; color: #6b7280; padding: 4px 8px; font-style: italic; }
.intake { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; margin-bottom: 8px; }
.intake .title { font-size: 12px; color: #374151; margin-bottom: 6px; font-weight: 600; }
.intake label { display: block; font-size: 11px; color: #6b7280; margin-bottom: 3px; }
.intake input { width: 100%; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 12.5px; margin-bottom: 6px; }
.intake button { width: 100%; padding: 7px; background: #075E54; color: #fff; border: 0; border-radius: 6px; font-weight: 600; font-size: 12.5px; cursor: pointer; }
.footer { padding: 10px; border-top: 1px solid #e5e7eb; background: #fff; flex: none; }
.input-row { display: flex; gap: 8px; }
.input-row input { flex: 1; min-width: 0; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 20px; font-size: 13px; outline: none; }
.input-row input:focus { border-color: #075E54; }
.input-row button { padding: 0 16px; border: 0; border-radius: 20px; font-weight: 600; font-size: 12.5px; cursor: pointer; }
.input-row button:disabled { opacity: .5; cursor: not-allowed; }
.wa-cta { margin-top: 10px; display: block; text-align: center; padding: 8px 12px; border-radius: 10px; background: #25D366; color: #fff; font-weight: 600; font-size: 12.5px; text-decoration: none; }
`;

/** The page script. It is a plain string so it can be inlined; it must not contain a backtick or a template placeholder. */
const SCRIPT = `
(function () {
  var TOKEN = __TOKEN__;
  var VKEY = 'wgt_vid_' + __WIDGET__;
  var BASE = '/widget/' + TOKEN + '/api/';
  var API_CFG = BASE + 'config';
  var API_MSG = BASE + 'message';
  var API_HIS = BASE + 'history';

  // The visitor id lives in the iframe's own localStorage, not only in a cookie: the page runs in a cross-site frame where
  // third-party cookies are often blocked, and without it every visit would start a new conversation. The key is built
  // from the widget, not from the token, so rotating the token does not orphan returning visitors.
  function storedUuid() { try { return localStorage.getItem(VKEY) || ''; } catch (e) { return ''; } }
  function storeUuid(u) { try { if (u) localStorage.setItem(VKEY, u); } catch (e) {} }
  function withVid(url) {
    var u = storedUuid();
    return u ? url + (url.indexOf('?') >= 0 ? '&' : '?') + 'visitor_uuid=' + encodeURIComponent(u) : url;
  }

  var cfg = null;
  var lastSeenMsgId = 0;
  var intakeDone = false;
  var sending = false;
  function $(id) { return document.getElementById(id); }

  function addBubble(dir, text, extras) {
    var m = $('msgs');
    var b = document.createElement('div');
    b.className = 'bubble ' + dir;
    if (dir === 'in' && cfg) {
      b.style.background = cfg.bubble_color || '#FFFFFF';
      b.style.color = cfg.bubble_text || '#222222';
    }
    b.textContent = text;
    if (extras && extras.id) b.dataset.id = extras.id;
    m.appendChild(b);
    m.scrollTop = m.scrollHeight;
  }

  function paintChrome() {
    document.body.style.background = cfg.body_bg_kind === 'image' && cfg.body_bg_image_url ? '#fff' : cfg.body_bg_color || '#ECE5DD';
    var msgs = $('msgs');
    var safeUrl = '';
    if (cfg.body_bg_kind === 'image' && cfg.body_bg_image_url) {
      try {
        var u = new URL(String(cfg.body_bg_image_url), window.location.href);
        if (u.protocol === 'http:' || u.protocol === 'https:') safeUrl = u.href.replace(/['"()\\\\]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
      } catch (e) { safeUrl = ''; }
    }
    if (safeUrl) {
      msgs.style.backgroundImage = "url('" + safeUrl + "')";
      msgs.style.backgroundSize = 'cover';
    } else {
      msgs.style.background = cfg.body_bg_color || '#ECE5DD';
    }
    var hdr = $('hdr');
    hdr.style.background = cfg.header_bg || '#075E54';
    hdr.style.color = cfg.header_text || '#FFFFFF';
    hdr.textContent = cfg.header_title || 'Chat';
    var btn = $('send');
    btn.textContent = cfg.button_label || 'Send';
    btn.style.background = cfg.button_bg || '#075E54';
    btn.style.color = cfg.button_text || '#FFFFFF';
  }

  function addWaCta() {
    var a = document.createElement('a');
    a.href = cfg.whatsapp_url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'wa-cta';
    a.textContent = 'Open WhatsApp';
    $('msgs').appendChild(a);
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
    t.textContent = 'Tell us a bit about you';
    box.appendChild(t);
    if (cfg.collect_name) field(box, 'Name', 'i-name', 'text');
    if (cfg.collect_email) field(box, 'Email', 'i-email', 'email');
    if (cfg.collect_phone) field(box, 'Phone', 'i-phone', 'tel');
    var go = document.createElement('button');
    go.id = 'i-go';
    go.type = 'button';
    go.textContent = 'Continue';
    go.onclick = function () {
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
        if (!res.ok) throw new Error('config ' + res.status);
        return res.json();
      })
      .then(function (data) {
        cfg = data.widget;
        var vis = data.visitor || {};
        storeUuid(vis.uuid);
        paintChrome();
        var transcript = data.transcript || [];
        if (transcript.length) {
          transcript.forEach(function (m) {
            addBubble(m.dir === 'out' ? 'out' : 'in', m.body || '', { id: m.id });
            if ((m.id || 0) > lastSeenMsgId) lastSeenMsgId = m.id;
          });
        } else if (cfg.welcome_message) {
          addBubble('in', cfg.welcome_message);
        }
        if (cfg.whatsapp_url && cfg.mode !== 'ai') addWaCta();
        if ((cfg.collect_name || cfg.collect_email || cfg.collect_phone) && !(vis.name || vis.email || vis.phone)) {
          renderIntake();
        } else {
          intakeDone = true;
          $('send').disabled = false;
        }
      })
      .catch(function () {
        // Reference left a blank page with a dead Send button; say what happened instead.
        document.getElementById('hdr').textContent = 'Chat';
        addBubble('in', 'This chat is not available right now.');
      });
  }

  function send() {
    var txt = $('txt');
    var body = (txt.value || '').trim();
    if (!body || $('send').disabled || sending) return;
    txt.value = '';
    addBubble('out', body);
    var payload = { body: body };
    var vid = storedUuid();
    if (vid) payload.visitor_uuid = vid;
    if (intakeDone) {
      var n = $('i-name'); if (n && n.value) payload.name = n.value;
      var e = $('i-email'); if (e && e.value) payload.email = e.value;
      var p = $('i-phone'); if (p && p.value) payload.phone = p.value;
    }
    var typing = document.createElement('div');
    typing.className = 'typing';
    typing.textContent = 'Typing\\u2026';
    $('msgs').appendChild(typing);
    $('msgs').scrollTop = $('msgs').scrollHeight;
    sending = true;
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
        typing.remove();
        if (!r.ok) {
          // Reference showed nothing for a refused message, so the visitor never knew it was lost.
          addBubble('in', "Sorry, that didn't go through. Please try again.");
          return;
        }
        var json = r.json;
        // The cursor moves past the visitor's own message (and the opening line stored before it), so the poll never
        // draws either again.
        if (json.inbound && json.inbound.id) lastSeenMsgId = Math.max(lastSeenMsgId, json.inbound.id);
        if (json.reply && json.reply.body) {
          addBubble('in', json.reply.body, { id: json.reply.id });
          lastSeenMsgId = Math.max(lastSeenMsgId, json.reply.id || 0);
        }
      })
      .catch(function () {
        typing.remove();
        addBubble('in', "Sorry, that didn't go through. Please try again.");
      })
      .then(function () { sending = false; });
  }

  $('send').addEventListener('click', send);
  $('txt').addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });

  // Replies a person typed in the team inbox arrive here: every business message not drawn yet is shown once.
  function poll() {
    fetch(withVid(API_HIS + '?since=' + lastSeenMsgId), { credentials: 'include' })
      .then(function (res) { return res.ok ? res.json() : { messages: [] }; })
      .then(function (json) {
        (json.messages || []).forEach(function (m) {
          if (!document.querySelector('[data-id="' + m.id + '"]')) addBubble('in', m.body || '', { id: m.id });
          if (m.id > lastSeenMsgId) lastSeenMsgId = m.id;
        });
      })
      .catch(function () {});
  }
  setInterval(poll, 4000);

  loadConfig();
})();
`;

export function renderChatPage(w: ChatPageWidget): string {
  const script = SCRIPT.replace('__TOKEN__', () => jsString(w.token)).replace('__WIDGET__', () =>
    jsString(w.uuid),
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(w.name)}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="header" id="hdr"></header>
<div class="body" id="msgs"></div>
<footer class="footer">
<div id="intake" class="intake" style="display:none"></div>
<div class="input-row">
<input id="txt" type="text" placeholder="Type a message…" aria-label="Type a message" autocomplete="off" />
<button id="send" type="button" disabled></button>
</div>
</footer>
<script>${script}</script>
</body>
</html>
`;
}
