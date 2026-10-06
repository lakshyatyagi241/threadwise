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
  nodes.forEach(function (node) {
    node.setAttribute('data-forms-mounted', '1');
    var frame = d.createElement('iframe');
    frame.src = ORIGIN + '/f/' + encodeURIComponent(KEY) + '?embed=1';
    frame.title = node.getAttribute('data-forms-title') || 'Form';
    frame.setAttribute('loading', 'lazy');
    frame.style.cssText = 'width:100%;border:0;display:block;min-height:320px;color-scheme:normal';
    node.appendChild(frame);

    function onMessage(e) {
      if (e.origin !== ORIGIN || e.source !== frame.contentWindow) return;
      var m = e.data;
      if (!m || m.source !== 'forms' || m.key !== KEY) return;
      if (m.type === 'resize' && typeof m.height === 'number' && isFinite(m.height)) {
        frame.style.height = Math.min(Math.max(Math.round(m.height), 120), 20000) + 'px';
      } else if (m.type === 'submitted') {
        node.dispatchEvent(new CustomEvent('forms:submitted', { bubbles: true, detail: { key: KEY } }));
      } else if (m.type === 'redirect' && typeof m.url === 'string' && /^https:\\/\\//i.test(m.url)) {
        window.location.href = m.url;
      }
    }
    window.addEventListener('message', onMessage);
  });
})();
`;
}

export const EMBED_NOT_FOUND_SCRIPT = '// form not found\n';
