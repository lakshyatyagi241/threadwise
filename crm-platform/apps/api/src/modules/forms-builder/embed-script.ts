/**
 * The loader a customer's site includes (docs/specs/forms-builder-app.md 7.3):
 *
 *   <script src="https://<api origin>/form-embed/<publicKey>/embed.js" async></script>
 *   <div data-forms-key="<publicKey>"></div>
 *
 * It injects an iframe of the hosted page (`<web origin>/f/<publicKey>?embed=1`), sizes it from the page's `postMessage`, and relays
 * `forms:submitted` to the host page. The message channel is ONE-WAY (child to parent): the page never accepts a message from its parent,
 * so a host page cannot remote-control a form. The loader acts on a message only when `event.origin` is the form's own origin AND
 * `event.source` is its own iframe, and follows a `redirect` only to an `https:` address.
 *
 * Values go into the script as JSON string literals (with `<` escaped), never as markup, so a key cannot break out of the script.
 */

/** A string as a JavaScript literal that is also safe inside an inline `<script>` element. */
export const jsString = (value: string): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');

export function buildEmbedScript(publicKey: string, webOrigin: string): string {
  const origin = webOrigin.replace(/\/+$/, '');
  return `(function () {
  var KEY = ${jsString(publicKey)};
  var ORIGIN = ${jsString(origin)};
  var d = document;
  var script = d.currentScript;
  var nodes = Array.prototype.slice.call(d.querySelectorAll('[data-forms-key]')).filter(function (n) {
    return n.getAttribute('data-forms-key') === KEY && !n.getAttribute('data-forms-mounted');
  });
  if (nodes.length === 0 && script && script.parentNode) {
    var made = d.createElement('div');
    made.setAttribute('data-forms-key', KEY);
    script.parentNode.insertBefore(made, script.nextSibling);
    nodes = [made];
  }

  // Trusts a message only from the form's own origin AND its own frame; follows a redirect to https only.
  function attach(frame, node, onSubmitted, onResize) {
    function onMessage(e) {
      if (e.origin !== ORIGIN || e.source !== frame.contentWindow) return;
      var m = e.data;
      if (!m || m.source !== 'forms' || m.key !== KEY) return;
      if (m.type === 'resize' && typeof m.height === 'number' && isFinite(m.height)) {
        var h = Math.min(Math.max(Math.round(m.height), 120), 20000);
        frame.style.height = (onResize ? onResize(h) : h) + 'px';
      } else if (m.type === 'submitted') {
        if (onSubmitted) onSubmitted();
        node.dispatchEvent(new CustomEvent('forms:submitted', { bubbles: true, detail: { key: KEY } }));
      } else if (m.type === 'redirect' && typeof m.url === 'string' && /^https:\\/\\//i.test(m.url)) {
        window.location.href = m.url;
      }
    }
    window.addEventListener('message', onMessage);
    return onMessage;
  }

  function num(v, min, max, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
  }

  // Popup mode: the same hosted page in a dialog that opens on a trigger (delay, scroll down, scroll up or a click).
  function popup(node) {
    var trigger = node.getAttribute('data-forms-trigger') || 'delay';
    var delay = num(node.getAttribute('data-forms-delay'), 0, 600, 5) * 1000;
    var scrollPct = num(node.getAttribute('data-forms-scroll'), 5, 100, 50);
    var days = num(node.getAttribute('data-forms-days'), 0, 365, 7);
    var pos = node.getAttribute('data-forms-position') === 'bottom_right' ? 'bottom_right' : 'center';
    var label = node.getAttribute('data-forms-title') || 'Form';
    var seenKey = 'forms:popup:' + KEY;
    var shown = false;
    var overlay = null;
    var frame = null;
    var returnTo = null;
    var listeners = [];

    function seen() {
      try {
        var v = window.localStorage.getItem(seenKey);
        if (!v) return false;
        return v === 'done' || Date.now() < Number(v);
      } catch (err) {
        return false;
      }
    }
    function remember(forever) {
      try {
        if (forever) window.localStorage.setItem(seenKey, 'done');
        else if (days > 0) window.localStorage.setItem(seenKey, String(Date.now() + days * 86400000));
      } catch (err) {
        /* storage blocked: the popup may show again, nothing breaks */
      }
    }
    function listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      listeners.push([target, type, fn]);
    }
    function stopTriggers() {
      listeners.forEach(function (l) {
        l[0].removeEventListener(l[1], l[2]);
      });
      listeners = [];
    }
    function styles() {
      if (d.getElementById('forms-popup-style')) return;
      var st = d.createElement('style');
      st.id = 'forms-popup-style';
      st.textContent =
        '.ff-pop{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(15,23,42,.55);animation:ff-fade .18s ease-out}' +
        '.ff-pop[data-pos=bottom_right]{align-items:flex-end;justify-content:flex-end;background:transparent;pointer-events:none}' +
        '.ff-pop-panel{position:relative;width:min(560px,100%);max-height:calc(100vh - 24px);overflow:auto;border-radius:12px;pointer-events:auto;animation:ff-rise .2s ease-out}' +
        '.ff-pop[data-pos=bottom_right] .ff-pop-panel{width:min(400px,100%)}' +
        '.ff-pop-x{position:absolute;top:8px;inset-inline-end:8px;z-index:1;width:36px;height:36px;border:0;border-radius:50%;background:rgba(15,23,42,.1);color:#111;cursor:pointer;font:22px/1 sans-serif}' +
        '.ff-pop-x:focus-visible{outline:3px solid #2563eb;outline-offset:2px}' +
        '@media (max-width:480px){.ff-pop,.ff-pop[data-pos=bottom_right]{padding:0;align-items:flex-end;justify-content:center}.ff-pop-panel,.ff-pop[data-pos=bottom_right] .ff-pop-panel{width:100%;max-height:92vh;border-radius:12px 12px 0 0}}' +
        '@keyframes ff-fade{from{opacity:0}to{opacity:1}}@keyframes ff-rise{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}' +
        '@media (prefers-reduced-motion:reduce){.ff-pop,.ff-pop-panel{animation:none}}';
      (d.head || d.documentElement).appendChild(st);
    }
    function close() {
      if (!shown) return;
      shown = false;
      d.removeEventListener('keydown', onKey);
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      d.documentElement.style.overflow = '';
      overlay = null;
      frame = null;
      remember(false);
      if (returnTo && returnTo.focus) returnTo.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    function open(force) {
      if (shown || (!force && seen())) return;
      shown = true;
      stopTriggers();
      styles();
      returnTo = d.activeElement;
      overlay = d.createElement('div');
      overlay.className = 'ff-pop';
      overlay.setAttribute('data-pos', pos);
      var panel = d.createElement('div');
      panel.className = 'ff-pop-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', label);
      var x = d.createElement('button');
      x.className = 'ff-pop-x';
      x.setAttribute('type', 'button');
      x.setAttribute('aria-label', node.getAttribute('data-forms-close') || 'Close');
      x.textContent = '\\u00d7';
      x.addEventListener('click', close);
      frame = d.createElement('iframe');
      frame.src = ORIGIN + '/f/' + encodeURIComponent(KEY) + '?embed=1';
      frame.title = label;
      frame.style.cssText = 'width:100%;border:0;display:block;height:320px;color-scheme:normal';
      attach(
        frame,
        node,
        function () {
          remember(true);
        },
        function (h) {
          return Math.min(h, Math.max(240, Math.floor(window.innerHeight * 0.92)));
        },
      );
      panel.appendChild(x);
      panel.appendChild(frame);
      overlay.appendChild(panel);
      if (pos === 'center') {
        overlay.addEventListener('click', function (e) {
          if (e.target === overlay) close();
        });
        d.documentElement.style.overflow = 'hidden';
      }
      d.body.appendChild(overlay);
      d.addEventListener('keydown', onKey);
      x.focus();
    }

    window.FormsPopup = window.FormsPopup || {};
    window.FormsPopup[KEY] = {
      open: function () {
        open(true);
      },
      close: close,
    };
    d.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-forms-open]') : null;
      if (t && t.getAttribute('data-forms-open') === KEY) {
        e.preventDefault();
        open(true);
      }
    });

    if (seen()) return;
    if (trigger === 'scroll_down') {
      var onDown = function () {
        var room = d.documentElement.scrollHeight - window.innerHeight;
        if (room > 0 && (window.pageYOffset / room) * 100 >= scrollPct) open(false);
      };
      listen(window, 'scroll', onDown, { passive: true });
      onDown();
    } else if (trigger === 'scroll_up') {
      // After the visitor has gone down the page a little, scrolling back up by 80px or more opens it.
      var top = 0;
      var onUp = function () {
        var y = window.pageYOffset;
        if (y > top) top = y;
        if (top > 200 && top - y >= 80) open(false);
      };
      listen(window, 'scroll', onUp, { passive: true });
    } else if (trigger === 'click') {
      /* opens from a [data-forms-open] element or FormsPopup[key].open() only */
    } else {
      var timer = window.setTimeout(function () {
        open(false);
      }, delay);
      listeners.push([
        { removeEventListener: function () { window.clearTimeout(timer); } },
        '',
        null,
      ]);
    }
  }

  nodes.forEach(function (node) {
    node.setAttribute('data-forms-mounted', '1');
    if (node.getAttribute('data-forms-mode') === 'popup') {
      popup(node);
      return;
    }
    var frame = d.createElement('iframe');
    frame.src = ORIGIN + '/f/' + encodeURIComponent(KEY) + '?embed=1';
    frame.title = node.getAttribute('data-forms-title') || 'Form';
    frame.setAttribute('loading', 'lazy');
    frame.style.cssText = 'width:100%;border:0;display:block;min-height:320px;color-scheme:normal';
    node.appendChild(frame);
    attach(frame, node, null, null);
  });
})();
`;
}

export const EMBED_NOT_FOUND_SCRIPT = '// form not found\n';
