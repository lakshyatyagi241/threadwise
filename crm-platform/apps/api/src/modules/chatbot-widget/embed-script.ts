import { buildLauncherScript, type WidgetLauncher } from '@crm/contracts';

/**
 * The loader a site pastes as `<script defer src=".../widget/<token>/embed">` (WD-WGT-008): it injects the floating
 * launcher and a hidden panel holding an iframe of the chat page.
 *
 * Values are put into the script as JSON string literals and into the DOM through properties, never through markup, so a
 * saved colour or image address cannot break out of the script or the element.
 */

export interface EmbedWidget {
  uuid: string;
  /** `whatsapp` widgets draw the messenger panel themselves (WD-WGT-028); `ai` and `both` open the chat page in a frame. */
  mode: string;
  name: string;
  launcher: WidgetLauncher;
  /** The `wa.me` link of the widget, or null when it has no number. */
  whatsappUrl: string | null;
  position: string;
  buttonColor: string;
  buttonImageUrl: string | null;
  autoOpen: boolean;
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

export function buildEmbedScript(w: EmbedWidget, chatUrl: string): string {
  if (w.mode === 'whatsapp') {
    // User-requested Interakt reference: the launcher opens a messenger panel whose button opens WhatsApp (WD-WGT-028).
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
  return `(function () {
  var GUARD = ${jsString(`__wgtWidget_${w.uuid}`)};
  if (window[GUARD]) return;
  window[GUARD] = true;

  var d = document;
  var side = ${jsString(side)};
  var wrap = d.createElement('div');
  wrap.style.cssText = 'position:fixed;bottom:24px;' + side + ':24px;z-index:2147483600;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

  var btn = d.createElement('button');
  btn.id = ${jsString(`wgt-launch-${short}`)};
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Open chat');
  btn.style.cssText = 'width:56px;height:56px;border-radius:9999px;border:0;box-shadow:0 6px 24px rgba(0,0,0,.18);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;';
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

  var panel = d.createElement('div');
  panel.id = ${jsString(`wgt-panel-${short}`)};
  panel.style.cssText = 'display:none;position:fixed;bottom:96px;' + side + ':24px;width:380px;height:560px;max-width:calc(100vw - 32px);max-height:calc(100vh - 120px);border-radius:14px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.25);background:#fff';
  var frame = d.createElement('iframe');
  frame.src = ${jsString(chatUrl)};
  frame.title = 'Chat';
  frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
  panel.appendChild(frame);

  wrap.appendChild(btn);
  wrap.appendChild(panel);
  d.body.appendChild(wrap);

  function toggle() { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; }
  btn.addEventListener('click', toggle);
${w.autoOpen ? '  setTimeout(toggle, 1200);\n' : ''}})();
`;
}

export const NOT_FOUND_SCRIPT = '// chatbot widget not found or paused\n';
