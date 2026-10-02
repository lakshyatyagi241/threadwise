import { z } from 'zod';

/**
 * The WhatsApp widget's look and placement (WD-WGT-028, user-requested Interakt reference): one config object stored in
 * `chatbot_widgets.launcher` (jsonb), carried by the admin API as `launcher`, resolved into the public config, and read by
 * the one script that draws the launcher and the messenger panel (`buildLauncherScript`), both on a customer's site and in
 * the builder's live preview.
 *
 * To add an option: add a key with a default to `widgetLauncherSchema`, read it in `buildLauncherScript` and give the
 * builder a control. No column, migration or API shape changes: rows that predate the key read the default.
 */

export const LAUNCHER_BUTTON_TYPES = ['pill', 'icon'] as const;
export type LauncherButtonType = (typeof LAUNCHER_BUTTON_TYPES)[number];
export const LAUNCHER_SIDES = ['left', 'right'] as const;
export type LauncherSide = (typeof LAUNCHER_SIDES)[number];

export const LAUNCHER_LIMITS = {
  greeting: 60,
  intro: 500,
  /** Pixels; a launcher further than this from an edge is off most screens. */
  spacing: 500,
  avatar: 1024,
} as const;

/** Fixed copy of the launcher and the panel. */
export const LAUNCHER_TEXT = {
  pill: 'Chat With Us',
  openLabel: 'Open chat',
  closeLabel: 'Close chat',
  reply: 'Typically replies within 5 mins',
  start: 'Start Conversation',
  noNumber: 'Add a WhatsApp number to start conversations',
} as const;

export interface LauncherColourPreset {
  key: string;
  name: string;
  /** The two ends of the gradient (135 degrees). */
  from: string;
  to: string;
}

/** The twelve named swatches of the builder, in display order. */
export const LAUNCHER_COLOUR_PRESETS: readonly LauncherColourPreset[] = [
  { key: 'original', name: 'The Original', from: '#25D366', to: '#128C7E' },
  { key: 'teal-deal', name: 'Teal Deal', from: '#2DD4BF', to: '#0F766E' },
  { key: 'green-lime', name: 'Green Lime', from: '#A3E635', to: '#4D7C0F' },
  { key: 'blue-lagoon', name: 'Blue Lagoon', from: '#38BDF8', to: '#1D4ED8' },
  { key: 'red-cherry', name: 'Red Cherry', from: '#FB7185', to: '#BE123C' },
  { key: 'orange-sunset', name: 'Orange Sunset', from: '#FDBA74', to: '#EA580C' },
  { key: 'yellow-sand', name: 'Yellow Sand', from: '#FDE047', to: '#CA8A04' },
  { key: 'pink-margarita', name: 'Pink Margarita', from: '#F9A8D4', to: '#DB2777' },
  { key: 'navy-suit', name: 'Navy Suit', from: '#3B5BA9', to: '#14213D' },
  { key: 'purple-velvet', name: 'Purple Velvet', from: '#C084FC', to: '#6B21A8' },
  { key: 'silver-spoon', name: 'Silver Spoon', from: '#D4D4D8', to: '#71717A' },
  { key: 'dark-night', name: 'Dark Night', from: '#52525B', to: '#09090B' },
] as const;

export const LAUNCHER_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const isPresetKey = (v: string) => LAUNCHER_COLOUR_PRESETS.some((p) => p.key === v);
export const isLauncherColour = (v: string): boolean => isPresetKey(v) || LAUNCHER_HEX.test(v);

const expandHex = (hex: string): string =>
  hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;

/** A custom colour's darker end: the colour mixed 22 percent towards black, so a custom swatch gets a gradient too. */
function darken(hex: string): string {
  const full = expandHex(hex).slice(1);
  const part = (i: number) =>
    Math.round(parseInt(full.slice(i, i + 2), 16) * 0.78)
      .toString(16)
      .padStart(2, '0');
  return `#${part(0)}${part(2)}${part(4)}`.toUpperCase();
}

export interface ResolvedLauncherColour {
  /** The preset key, or null for a custom colour. */
  key: string | null;
  from: string;
  to: string;
}

/** A preset key or a hex colour as its two gradient ends; anything else falls back to the original green. */
export function resolveLauncherColour(colour: string): ResolvedLauncherColour {
  const preset = LAUNCHER_COLOUR_PRESETS.find((p) => p.key === colour);
  if (preset) return { key: preset.key, from: preset.from, to: preset.to };
  if (LAUNCHER_HEX.test(colour)) {
    const from = expandHex(colour).toUpperCase();
    return { key: null, from, to: darken(from) };
  }
  const original = LAUNCHER_COLOUR_PRESETS[0]!;
  return { key: original.key, from: original.from, to: original.to };
}

// --- messenger image ----------------------------------------------------------------------------------------------------

export interface LauncherAvatarPreset {
  key: string;
  name: string;
  background: string;
  /** Stroke paths of a 24 by 24 glyph, drawn in white. */
  glyph: string;
}

/** The built-in messenger images (no upload: an own image is an address). */
export const LAUNCHER_AVATARS: readonly LauncherAvatarPreset[] = [
  {
    key: 'support',
    name: 'Support',
    background: '#128C7E',
    glyph:
      'M4 13v-1a8 8 0 0 1 16 0v1M4 13h3v5H5a1 1 0 0 1-1-1zM20 13h-3v5h2a1 1 0 0 0 1-1zM18 18c0 2-2 3-5 3',
  },
  {
    key: 'store',
    name: 'Store',
    background: '#1D4ED8',
    glyph:
      'M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9M10 20v-5h4v5',
  },
  {
    key: 'chat',
    name: 'Chat',
    background: '#6B21A8',
    glyph:
      'M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l1.9-5.6A8.4 8.4 0 1 1 21 11.5zM8.5 10.5h7M8.5 13.5h4',
  },
  {
    key: 'person',
    name: 'Person',
    background: '#BE123C',
    glyph: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  },
] as const;

export const LAUNCHER_AVATAR_PREFIX = 'preset:';
export const DEFAULT_LAUNCHER_AVATAR = `${LAUNCHER_AVATAR_PREFIX}support`;

/** Only an absolute http(s) address can be an image (a `javascript:` or `data:` address is refused). */
export function launcherImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  // No URL class in the contracts' libs: a scheme check, no whitespace or quotes (the value only ever reaches `img.src`).
  return /^https?:\/\/[^\s'"<>\\]{1,1000}$/i.test(v) ? v : null;
}

export const isLauncherAvatar = (v: string): boolean =>
  v === '' ||
  LAUNCHER_AVATARS.some((a) => v === `${LAUNCHER_AVATAR_PREFIX}${a.key}`) ||
  launcherImageUrl(v) !== null;

function avatarDataUri(a: LauncherAvatarPreset): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><rect width='48' height='48' fill='${a.background}'/>` +
    `<g transform='translate(12 12)' fill='none' stroke='white' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='${a.glyph}'/></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/** What an `<img src>` shows for a stored messenger image: a built-in glyph as a data address, an own image as its URL. */
export function launcherAvatarSrc(value: string): string {
  const preset = LAUNCHER_AVATARS.find((a) => value === `${LAUNCHER_AVATAR_PREFIX}${a.key}`);
  if (preset) return avatarDataUri(preset);
  const url = launcherImageUrl(value);
  if (url) return url;
  return avatarDataUri(LAUNCHER_AVATARS[0]!);
}

// --- the WhatsApp link ----------------------------------------------------------------------------------------------------

/** PHP's `urlencode`: spaces become `+` and everything outside `[A-Za-z0-9_.-]` is percent-encoded (WaDesk built the link with it). */
export function phpUrlencode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}

/**
 * `https://wa.me/<country code><number>?text=<pre-filled message>`: digits only in the path, the message url-encoded, no
 * query when there is no message. Null when there are no digits. The API (public config, embed script) and the builder's
 * preview build the link with this one function, so what the preview opens is what a visitor gets.
 */
export function buildWhatsappLink(
  cc: string | null | undefined,
  number: string | null | undefined,
  message: string | null | undefined,
): string | null {
  const digits = `${cc ?? ''}${number ?? ''}`.replace(/\D+/g, '');
  if (digits === '') return null;
  const text = phpUrlencode(message ?? '');
  return `https://wa.me/${digits}${text !== '' ? `?text=${text}` : ''}`;
}

// --- the config ---------------------------------------------------------------------------------------------------------

const spacing = z
  .number({ invalid_type_error: 'Use a whole number of pixels.' })
  .int('Use a whole number of pixels.')
  .min(0, 'Spacing cannot be negative.')
  .max(LAUNCHER_LIMITS.spacing, `Spacing cannot be more than ${LAUNCHER_LIMITS.spacing}px.`);

const placement = (bottom: number) =>
  z
    .object({
      side: z.enum(LAUNCHER_SIDES).default('right'),
      sideSpacing: spacing.default(10),
      bottomSpacing: spacing.default(bottom),
    })
    .default({});

export const widgetLauncherSchema = z.object({
  buttonType: z.enum(LAUNCHER_BUTTON_TYPES).default('pill'),
  /** A preset key (`original`, `teal-deal`, ...) or a hex colour. */
  colour: z
    .string()
    .refine(isLauncherColour, 'Pick one of the colours or a hex value like #25D366.')
    .default('original'),
  /** `preset:<key>` of a built-in image, or an absolute http(s) image address. */
  avatar: z
    .string()
    .max(LAUNCHER_LIMITS.avatar)
    .refine(isLauncherAvatar, 'Use a built-in image or an http(s) image address.')
    .default(DEFAULT_LAUNCHER_AVATAR),
  greeting: z
    .string()
    .trim()
    .min(1, 'Add a greeting.')
    .max(LAUNCHER_LIMITS.greeting)
    .default('HI THERE!'),
  introMessage: z
    .string()
    .trim()
    .min(1, 'Add an intro message.')
    .max(LAUNCHER_LIMITS.intro)
    .default('We are here to help you! Chat with us on WhatsApp for any queries.'),
  desktop: placement(10),
  mobile: placement(60),
});
export type WidgetLauncher = z.infer<typeof widgetLauncherSchema>;

/** The same object as the API returns it: every key present, no defaults (a response is never parsed into a default). */
const placementView = z.object({
  side: z.enum(LAUNCHER_SIDES),
  sideSpacing: z.number().int(),
  bottomSpacing: z.number().int(),
});
export const widgetLauncherViewSchema = z.object({
  buttonType: z.enum(LAUNCHER_BUTTON_TYPES),
  colour: z.string(),
  avatar: z.string(),
  greeting: z.string(),
  introMessage: z.string(),
  desktop: placementView,
  mobile: placementView,
});

export type WidgetLauncherInput = z.input<typeof widgetLauncherSchema>;

export const DEFAULT_LAUNCHER: WidgetLauncher = widgetLauncherSchema.parse({});

/** What a stored `launcher` column reads as: missing keys take their default, garbage falls back to the defaults. */
export function parseLauncher(raw: unknown): WidgetLauncher {
  const r = widgetLauncherSchema.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_LAUNCHER;
}

// --- the public shape (snake_case, like the rest of the public protocol) ----------------------------------------------

export const widgetPublicLauncherSchema = z.object({
  button_type: z.enum(LAUNCHER_BUTTON_TYPES),
  colour: z.object({ key: z.string().nullable(), from: z.string(), to: z.string() }),
  avatar_url: z.string(),
  greeting: z.string(),
  intro_message: z.string(),
  desktop: z.object({
    side: z.enum(LAUNCHER_SIDES),
    side_spacing: z.number().int(),
    bottom_spacing: z.number().int(),
  }),
  mobile: z.object({
    side: z.enum(LAUNCHER_SIDES),
    side_spacing: z.number().int(),
    bottom_spacing: z.number().int(),
  }),
});
export type WidgetPublicLauncher = z.infer<typeof widgetPublicLauncherSchema>;

export function toPublicLauncher(l: WidgetLauncher): WidgetPublicLauncher {
  return {
    button_type: l.buttonType,
    colour: resolveLauncherColour(l.colour),
    avatar_url: launcherAvatarSrc(l.avatar),
    greeting: l.greeting,
    intro_message: l.introMessage,
    desktop: {
      side: l.desktop.side,
      side_spacing: l.desktop.sideSpacing,
      bottom_spacing: l.desktop.bottomSpacing,
    },
    mobile: {
      side: l.mobile.side,
      side_spacing: l.mobile.sideSpacing,
      bottom_spacing: l.mobile.bottomSpacing,
    },
  };
}

// --- the script ---------------------------------------------------------------------------------------------------------

export interface LauncherScriptInput {
  /** A per-widget id: guards against a double load and names the elements. */
  id: string;
  /** The business name shown in the panel header. */
  name: string;
  launcher: WidgetLauncher;
  /** The `wa.me` link Start Conversation opens, or null when the widget has no number. */
  whatsappUrl: string | null;
  autoOpen?: boolean;
  /** Builder preview: no double-load guard, tells the parent window when the panel opens or closes. */
  preview?: boolean;
  /** `auto` follows the window width (`max-width: 768px` is mobile); the preview pins one of the two. */
  device?: 'auto' | 'desktop' | 'mobile';
  startOpen?: boolean;
}

/** A string as a JavaScript literal that is also safe inside an inline `<script>` element. */
const literal = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');

// The runtime is a fixed program that reads a data object; no saved value is ever spliced into code, and every value reaches
// the page through a property (textContent, src, style) rather than markup.
const RUNTIME = `
(function (C) {
  var d = document;
  var win = window;
  if (!C.preview) { if (win[C.guard]) return; win[C.guard] = true; }
  var K = 'wgt-' + C.id;
  var grad = 'linear-gradient(135deg,' + C.from + ',' + C.to + ')';

  var style = d.createElement('style');
  function place(dev, p) {
    return '.' + K + '[data-dev="' + dev + '"]{' + (p.side === 'left' ? 'left:' + p.s + 'px;right:auto;align-items:flex-start;' : 'right:' + p.s + 'px;left:auto;align-items:flex-end;') + 'bottom:' + p.b + 'px}';
  }
  style.textContent = '.' + K + '{position:fixed;z-index:2147483600;display:flex;flex-direction:column;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.35}'
    + '.' + K + ' *{box-sizing:border-box}'
    + place('d', C.desktop) + place('m', C.mobile)
    + '.' + K + ' button{font-family:inherit}'
    + '.' + K + ' button:focus-visible{outline:3px solid #fff;box-shadow:0 0 0 5px #1d4ed8}';
  d.head.appendChild(style);

  function el(tag, css, text) {
    var n = d.createElement(tag);
    if (css) n.style.cssText = css;
    if (text) n.textContent = text;
    return n;
  }
  function svg(markup, size) {
    var s = el('span', 'display:inline-flex;width:' + size + 'px;height:' + size + 'px;flex:none');
    s.innerHTML = markup;
    return s;
  }
  var WA = "<svg viewBox='0 0 32 32' width='100%' height='100%' fill='none'><path d='M16 4.5a11.3 11.3 0 0 0-9.7 17l-1.5 5.6 5.7-1.5A11.3 11.3 0 1 0 16 4.5z' stroke='#fff' stroke-width='2.2' stroke-linejoin='round'/><path d='M12 10.5c-.7.7-1 1.6-.7 2.8.8 3.2 3.6 6 6.9 6.9 1.1.3 2-.1 2.6-.8l-1.8-2.1-1.6.8c-1.2-.5-2.4-1.7-2.9-2.9l.8-1.5z' fill='#fff'/></svg>";
  var SEND = "<svg viewBox='0 0 24 24' width='100%' height='100%' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M22 2 11 13M22 2l-7 20-4-9-9-4z'/></svg>";
  var DOWN = "<svg viewBox='0 0 24 24' width='100%' height='100%' fill='none' stroke='#fff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>";

  var wrap = el('div');
  wrap.className = K;
  wrap.setAttribute('data-testid', 'wgt-embed');

  // --- panel
  var panel = el('div', 'display:none;width:340px;max-width:calc(100vw - 20px);margin-bottom:12px;border-radius:18px;overflow:hidden;background:#efeae2;box-shadow:0 14px 48px rgba(0,0,0,.28)');
  panel.id = 'wgt-panel-' + C.id;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', C.name);

  var head = el('div', 'display:flex;align-items:center;gap:12px;padding:14px 16px;color:#fff;background:' + grad);
  var avatar = el('img', 'width:46px;height:46px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.85);background:#fff;flex:none');
  avatar.alt = '';
  avatar.src = C.avatar;
  var who = el('div', 'min-width:0');
  var title = el('div', 'font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', C.name);
  title.setAttribute('data-testid', 'wgt-name');
  var reply = el('div', 'font-size:12px;opacity:.92;margin-top:2px', C.text.reply);
  who.appendChild(title);
  who.appendChild(reply);
  head.appendChild(avatar);
  head.appendChild(who);

  var body = el('div', 'padding:16px 16px 6px');
  var greet = el('div', 'font-size:13px;font-weight:700;letter-spacing:.02em;text-align:center;color:#3b4a54;margin-bottom:10px;overflow-wrap:anywhere', C.greeting);
  greet.setAttribute('data-testid', 'wgt-greeting');
  var bubble = el('div', 'position:relative;background:#fff;color:#111b21;border-radius:2px 14px 14px 14px;padding:10px 54px 10px 12px;font-size:14px;box-shadow:0 1px 1px rgba(0,0,0,.12);overflow-wrap:anywhere;white-space:pre-wrap');
  bubble.setAttribute('data-testid', 'wgt-intro');
  var introText = el('span', '', C.intro);
  var time = el('span', 'position:absolute;right:10px;bottom:5px;font-size:11px;color:#667781');
  try { time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { time.textContent = ''; }
  bubble.appendChild(introText);
  bubble.appendChild(time);
  body.appendChild(greet);
  body.appendChild(bubble);

  var foot = el('div', 'padding:14px 16px 18px');
  var start = el('button', 'width:100%;height:50px;border:0;border-radius:26px;color:#fff;font-size:15.5px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;background:' + grad);
  start.type = 'button';
  start.id = 'wgt-start-' + C.id;
  start.setAttribute('data-testid', 'wgt-start');
  start.setAttribute('data-wa', C.wa || '');
  start.appendChild(el('span', '', C.text.start));
  start.appendChild(svg(SEND, 18));
  if (C.wa) {
    start.addEventListener('click', function () { win.open(C.wa, '_blank', 'noopener'); });
  } else {
    start.disabled = true;
    start.style.opacity = '.55';
    start.style.cursor = 'not-allowed';
    start.title = C.text.noNumber;
  }
  foot.appendChild(start);

  panel.appendChild(head);
  panel.appendChild(body);
  panel.appendChild(foot);

  // --- launcher and the round button that takes its place while the panel is open
  var launch = el('button', 'border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;color:#fff;font-weight:700;font-size:15px;box-shadow:0 8px 26px rgba(0,0,0,.25);background:' + grad
    + (C.type === 'pill' ? ';height:54px;padding:0 22px 0 16px;border-radius:27px' : ';width:62px;height:62px;padding:0;border-radius:50%'));
  launch.type = 'button';
  launch.id = 'wgt-launch-' + C.id;
  launch.setAttribute('data-testid', 'wgt-launcher');
  launch.setAttribute('aria-label', C.text.open);
  launch.setAttribute('aria-expanded', 'false');
  launch.appendChild(svg(WA, C.type === 'pill' ? 28 : 34));
  if (C.type === 'pill') launch.appendChild(el('span', '', C.text.pill));

  var close = el('button', 'display:none;border:0;cursor:pointer;width:50px;height:50px;padding:0;border-radius:50%;align-items:center;justify-content:center;box-shadow:0 8px 26px rgba(0,0,0,.25);background:' + grad);
  close.type = 'button';
  close.id = 'wgt-close-' + C.id;
  close.setAttribute('data-testid', 'wgt-close');
  close.setAttribute('aria-label', C.text.close);
  close.appendChild(svg(DOWN, 26));

  wrap.appendChild(panel);
  wrap.appendChild(launch);
  wrap.appendChild(close);
  d.body.appendChild(wrap);

  var open = false;
  function show(next) {
    open = next;
    panel.style.display = open ? 'block' : 'none';
    launch.style.display = open ? 'none' : 'flex';
    close.style.display = open ? 'flex' : 'none';
    launch.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (C.preview && win.parent && win.parent !== win) win.parent.postMessage({ wgt: 'toggle', open: open }, '*');
    if (open) start.focus({ preventScroll: true }); else launch.focus({ preventScroll: true });
  }
  launch.addEventListener('click', function () { show(true); });
  close.addEventListener('click', function () { show(false); });
  d.addEventListener('keydown', function (e) { if (open && e.key === 'Escape') show(false); });

  var mq = win.matchMedia ? win.matchMedia('(max-width: 768px)') : null;
  function device() {
    if (C.device === 'mobile') return 'm';
    if (C.device === 'desktop') return 'd';
    return mq && mq.matches ? 'm' : 'd';
  }
  function apply() { wrap.setAttribute('data-dev', device()); }
  apply();
  if (mq && C.device === 'auto') { if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply); }

  if (C.startOpen) { panel.style.display = 'block'; launch.style.display = 'none'; close.style.display = 'flex'; open = true; launch.setAttribute('aria-expanded', 'true'); }
  else if (C.autoOpen) setTimeout(function () { if (!open) show(true); }, 1200);
})
`;

/** The loader of a WhatsApp-mode widget: draws the launcher and the messenger panel directly on the host page. */
export function buildLauncherScript(i: LauncherScriptInput): string {
  const colour = resolveLauncherColour(i.launcher.colour);
  const data = {
    guard: `__wgtWidget_${i.id}`,
    id: i.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 12),
    name: i.name,
    type: i.launcher.buttonType,
    from: colour.from,
    to: colour.to,
    avatar: launcherAvatarSrc(i.launcher.avatar),
    greeting: i.launcher.greeting,
    intro: i.launcher.introMessage,
    desktop: {
      side: i.launcher.desktop.side,
      s: i.launcher.desktop.sideSpacing,
      b: i.launcher.desktop.bottomSpacing,
    },
    mobile: {
      side: i.launcher.mobile.side,
      s: i.launcher.mobile.sideSpacing,
      b: i.launcher.mobile.bottomSpacing,
    },
    wa: i.whatsappUrl,
    autoOpen: i.autoOpen === true,
    preview: i.preview === true,
    device: i.device ?? 'auto',
    startOpen: i.startOpen === true,
    text: {
      pill: LAUNCHER_TEXT.pill,
      open: LAUNCHER_TEXT.openLabel,
      close: LAUNCHER_TEXT.closeLabel,
      reply: LAUNCHER_TEXT.reply,
      start: LAUNCHER_TEXT.start,
      noNumber: LAUNCHER_TEXT.noNumber,
    },
  };
  return `${RUNTIME.trim()}(${literal(data)});\n`;
}
