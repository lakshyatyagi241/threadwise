import { z } from 'zod';

/**
 * The WhatsApp widget's look and placement (TW-WGT-028, user-requested Interakt reference): one config object stored in
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
  /** The name in the panel header, the line under it, and the text of the start button. */
  botName: 24,
  subHeader: 36,
  cta: 20,
  popupText: 200,
  /** The line shown after a visitor rates a reply. */
  feedbackMessage: 200,
} as const;

/** A language code such as `en`, `pt` or `pt-BR`. */
export const CHAT_LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
export const CHAT_LANGUAGES_MAX = 10;

/** What draws the eye to a closed launcher: nothing, a bounce, or a ripple ring. */
export const LAUNCHER_ANIMATIONS = ['none', 'bounce', 'ripple'] as const;
export type LauncherAnimation = (typeof LAUNCHER_ANIMATIONS)[number];
/** Where the popup bubble sits: beside the launcher or above it. */
export const POPUP_POSITIONS = ['side', 'top'] as const;
export type PopupPosition = (typeof POPUP_POSITIONS)[number];
/**
 * How a website chat bot's callout looks beside its closed launcher: a bubble above it, a pill beside it, a pill with an avatar, a card
 * with a picture, or a bar that looks like the chat's input. The WhatsApp button draws only its `position` (above or beside).
 */
export const POPUP_STYLES = ['bubble', 'pill', 'avatar', 'media', 'bar'] as const;
export type PopupStyle = (typeof POPUP_STYLES)[number];
/**
 * How a website chat bot's chat window looks and behaves beyond its colours: how reply buttons are filled and shaped, the typeface and
 * size, the suggestions under the conversation, the copy / like / dislike icons under a bot line, the expand button and the voice
 * conversation. The typefaces are the visitor's own system faces: the window loads nothing from another site.
 */
export const CHAT_FILLS = ['outline', 'tinted', 'solid'] as const;
export const CHAT_SHAPES = ['pill', 'rounded', 'soft', 'square'] as const;
export const CHAT_FONTS = ['system', 'serif', 'rounded', 'humanist', 'mono'] as const;
export const CHAT_SIZES = ['compact', 'standard', 'tall', 'wide'] as const;
/** The header's fill: the colour flat, or a gradient from it. */
export const CHAT_HEADERS = ['solid', 'diagonal', 'vivid', 'dusk', 'soft'] as const;
/** The text direction: follow the visitor's language, or force one. */
export const CHAT_DIRECTIONS = ['auto', 'ltr', 'rtl'] as const;
/** The body's corners: the chat window and its bubbles. */
export const CHAT_CORNERS = ['rounded', 'soft', 'square'] as const;
export const CHAT_ITEMS_MAX = 5;
/** Limits of a notification card (Geta console: 60, 100, 28, 20). */
export const CHAT_NOTICE_LIMITS = { title: 60, description: 100, button: 28, footer: 20 } as const;
export const CHAT_MENU_LABEL_MAX = 40;
export const CHAT_MENU_VIEWS = ['list', 'blocks'] as const;
/** The four bell styles of the notification block. */
export const CHAT_NOTICE_ICONS = [1, 2, 3, 4] as const;
export const CHAT_FONT_SIZE_MIN = 12;
export const CHAT_FONT_SIZE_MAX = 18;
/** Seconds to wait before the window opens by itself; 0 keeps it closed. */
export const CHAT_AUTO_OPEN_MAX = 120;
export const CHAT_SUGGESTIONS_MAX = 4;
export const CHAT_SUGGESTION_MAX_CHARS = 60;
/** The panel's width and height in pixels for each size. */
export const CHAT_SIZE_PX: Record<(typeof CHAT_SIZES)[number], { w: number; h: number }> = {
  compact: { w: 372, h: 560 },
  standard: { w: 404, h: 672 },
  tall: { w: 404, h: 780 },
  wide: { w: 468, h: 700 },
};

/** A button address a visitor may follow: a web page, a phone call or an email. */
export const chatActionUrl = (v: string): boolean =>
  v === '' || /^(https?:\/\/|tel:|mailto:)[^\s'"<>\\]{1,1000}$/i.test(v);

const VIDEO_EMBED =
  /^https:\/\/(www\.youtube(-nocookie)?\.com\/embed\/[\w-]{6,20}|player\.vimeo\.com\/video\/\d{4,12})(\?[\w=&%.-]*)?$/;
/** The only video addresses the banner may frame: a YouTube or Vimeo embed. */
export const isChatVideoEmbed = (v: string): boolean => v === '' || VIDEO_EMBED.test(v);

/**
 * A pasted video link, or the iframe code a video site hands out, as the embed address the banner frames. YouTube watch, short and
 * youtu.be links and Vimeo links are turned into their embed form; anything else comes back empty.
 */
export function chatVideoEmbedFrom(input: string): string {
  const text = input.trim();
  const src = /src\s*=\s*["']([^"']+)["']/i.exec(text)?.[1] ?? text;
  if (isChatVideoEmbed(src) && src !== '') return src;
  const yt =
    /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{6,20})/i.exec(
      src,
    )?.[1];
  if (yt) return `https://www.youtube.com/embed/${yt}`;
  const vm = /vimeo\.com\/(?:video\/)?(\d{4,12})/i.exec(src)?.[1];
  return vm ? `https://player.vimeo.com/video/${vm}` : '';
}

/** A step of the bot's own flow a tap jumps to (empty: no jump). */
const chatNode = z
  .string()
  .trim()
  .max(64)
  .refine((v) => v === '' || /^[\w-]+$/.test(v), 'Pick a step of the bot.')
  .default('');

const chatAction = z
  .string()
  .trim()
  .max(1024)
  .refine(chatActionUrl, 'Use an http(s), tel: or mailto: address.')
  .default('');

const chatNoticeIcon = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export const chatNoticeItemSchema = z.object({
  image: z
    .string()
    .max(LAUNCHER_LIMITS.avatar)
    .refine((v) => v === '' || launcherImageUrl(v) !== null, 'Use an uploaded image.')
    .default(''),
  title: z.string().trim().min(1).max(CHAT_NOTICE_LIMITS.title),
  description: z.string().trim().min(1).max(CHAT_NOTICE_LIMITS.description),
  buttonTitle: z.string().trim().max(CHAT_NOTICE_LIMITS.button).default(''),
  buttonUrl: chatAction,
  footer: z.string().trim().max(CHAT_NOTICE_LIMITS.footer).default(''),
});
export const chatMenuItemSchema = z.object({
  image: z
    .string()
    .max(LAUNCHER_LIMITS.avatar)
    .refine((v) => v === '' || launcherImageUrl(v) !== null, 'Use an uploaded image.')
    .default(''),
  title: z.string().trim().min(1).max(CHAT_MENU_LABEL_MAX),
  /** A page to open; empty sends the title as the visitor's message, which the bot answers. */
  url: chatAction,
  /** Or a step of the bot's flow the tap starts from (used when there is no page address). */
  node: chatNode,
});
export const chatBannerItemSchema = z.object({
  kind: z.enum(['image', 'video']).default('image'),
  image: z
    .string()
    .max(LAUNCHER_LIMITS.avatar)
    .refine((v) => v === '' || launcherImageUrl(v) !== null, 'Use an uploaded image.')
    .default(''),
  video: z.string().max(300).refine(isChatVideoEmbed, 'Use a YouTube or Vimeo video.').default(''),
  url: chatAction,
  /** Or a step of the bot's flow a tap on the slide starts from (used when there is no link). */
  node: chatNode,
});
export type ChatNoticeItem = z.infer<typeof chatNoticeItemSchema>;
export type ChatMenuItem = z.infer<typeof chatMenuItemSchema>;
export type ChatBannerItem = z.infer<typeof chatBannerItemSchema>;

const chatImage = z
  .string()
  .max(LAUNCHER_LIMITS.avatar)
  .refine(
    (v) => v === '' || launcherImageUrl(v) !== null,
    'Use an uploaded image or an http(s) image address.',
  )
  .default('');
export const widgetChatOptionsSchema = z.object({
  fill: z.enum(CHAT_FILLS).default('outline'),
  shape: z.enum(CHAT_SHAPES).default('pill'),
  font: z.enum(CHAT_FONTS).default('system'),
  size: z.enum(CHAT_SIZES).default('standard'),
  header: z.enum(CHAT_HEADERS).default('diagonal'),
  direction: z.enum(CHAT_DIRECTIONS).default('auto'),
  /** The round icon in front of each reply button. */
  icons: z.boolean().default(true),
  /** Lines of text offered under the conversation until the visitor writes (up to four). */
  suggestions: z
    .array(z.string().trim().min(1).max(CHAT_SUGGESTION_MAX_CHARS))
    .max(CHAT_SUGGESTIONS_MAX)
    .default([]),
  /** Quick replies on or off; the lines are kept when off. */
  suggestionsOn: z.boolean().default(true),
  /** For each suggestion, by position, the step of the flow a tap starts from; empty sends the line as a message. */
  suggestionNodes: z
    .array(
      z
        .string()
        .trim()
        .max(64)
        .refine((v) => v === '' || /^[\w-]+$/.test(v), 'Pick a step of the bot.'),
    )
    .max(CHAT_SUGGESTIONS_MAX)
    .default([]),
  /** Copy, helpful and not helpful under a bot's line. */
  actions: z.boolean().default(true),
  /** The panel's expand button. */
  expand: z.boolean().default(true),
  /** The microphone: talk to the bot, and hear it answer, with the browser's own speech tools. */
  voice: z.boolean().default(false),
  /** The company logo in the header, the bot's picture beside its lines and a picture behind the conversation: an uploaded image's address, or empty. */
  logo: chatImage,
  avatar: chatImage,
  background: chatImage,
  corner: z.enum(CHAT_CORNERS).default('rounded'),
  autoOpen: z.number().int().min(0).max(CHAT_AUTO_OPEN_MAX).default(0),
  /** A soft sound when a bot line arrives while the window is open. */
  sound: z.boolean().default(false),
  /** The bell in the header: cards with a picture, a title, a line, a button and a footer. */
  notice: z
    .object({
      enabled: z.boolean().default(false),
      icon: chatNoticeIcon.default(1),
      items: z.array(chatNoticeItemSchema).max(CHAT_ITEMS_MAX).default([]),
    })
    .default({}),
  /** The menu in the header: rows or blocks, each opens a page or sends its title as the visitor's message. */
  quickMenu: z
    .object({
      enabled: z.boolean().default(false),
      view: z.enum(CHAT_MENU_VIEWS).default('list'),
      items: z.array(chatMenuItemSchema).max(CHAT_ITEMS_MAX).default([]),
    })
    .default({}),
  /** A picture or video strip above the conversation, one slide at a time. */
  banners: z
    .object({
      enabled: z.boolean().default(false),
      items: z.array(chatBannerItemSchema).max(CHAT_ITEMS_MAX).default([]),
    })
    .default({}),
  fontSize: z.number().int().min(CHAT_FONT_SIZE_MIN).max(CHAT_FONT_SIZE_MAX).default(14),
  /** Reply buttons' background while the pointer is on them; empty keeps the tint. */
  hoverBg: z
    .string()
    .refine((v) => v === '' || LAUNCHER_HEX.test(v), 'Use a hex colour.')
    .default(''),
  /** The volume of the new-line sound, 0 to 100. */
  soundVolume: z.number().int().min(0).max(100).default(70),
  /** Read the bot's lines aloud with the browser's own voice. */
  speak: z.boolean().default(false),
  /** Offer a floating chat window (picture-in-picture) when the visitor switches to another tab mid-conversation. */
  pip: z.boolean().default(false),
  /**
   * Thumbs up / down under a bot line. `enabled` off hides the thumbs (copy stays with `actions`) and keeps `message`, the line a visitor
   * sees after rating a reply, so switching it back on loses nothing.
   */
  feedback: z
    .object({
      enabled: z.boolean().default(true),
      message: z.string().max(LAUNCHER_LIMITS.feedbackMessage).default(''),
    })
    .default({}),
  /**
   * The languages the chat window speaks. `primary` empty follows the visitor's browser (how every window behaved before this setting);
   * a code makes that language the window's own, and a visitor's browser language is honoured only when listed in `additional`.
   */
  languages: z
    .object({
      primary: z
        .string()
        .regex(CHAT_LANGUAGE_CODE, 'Use a language code like en or pt-BR.')
        .or(z.literal(''))
        .default(''),
      additional: z.array(z.string().regex(CHAT_LANGUAGE_CODE)).max(CHAT_LANGUAGES_MAX).default([]),
    })
    .default({}),
  /** Where the widget shows at all. */
  devices: z
    .object({
      desktop: z.boolean().default(true),
      tablet: z.boolean().default(true),
      mobile: z.boolean().default(true),
    })
    .default({}),
});
export type WidgetChatOptions = z.infer<typeof widgetChatOptionsSchema>;

export const DEFAULT_POPUP_TEXT = 'Hi! May I assist you?';

/** Fixed copy of the launcher and the panel. */
export const LAUNCHER_TEXT = {
  pill: 'Chat With Us',
  openLabel: 'Open chat',
  closeLabel: 'Close chat',
  dismissLabel: 'Dismiss',
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

/** PHP's `urlencode`: spaces become `+` and everything outside `[A-Za-z0-9_.-]` is percent-encoded (Reference built the link with it). */
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
  /** The name in the panel header; empty shows the bot's own name. */
  botName: z.string().trim().max(LAUNCHER_LIMITS.botName).default(''),
  /** The line under the name. */
  subHeader: z.string().trim().max(LAUNCHER_LIMITS.subHeader).default(LAUNCHER_TEXT.reply),
  /** The text of the button that opens WhatsApp. */
  ctaText: z
    .string()
    .trim()
    .min(1, 'Add the button text.')
    .max(LAUNCHER_LIMITS.cta)
    .default(LAUNCHER_TEXT.start),
  /** The small bubble beside or above the closed launcher. Off by default, so a widget saved before it existed looks as it did. */
  popup: z
    .object({
      enabled: z.boolean().default(false),
      position: z.enum(POPUP_POSITIONS).default('top'),
      style: z.enum(POPUP_STYLES).default('bubble'),
      text: z.string().trim().max(LAUNCHER_LIMITS.popupText).default(DEFAULT_POPUP_TEXT),
      /** Optional image: `preset:<key>`, an http(s) address, or empty for none. */
      image: z
        .string()
        .max(LAUNCHER_LIMITS.avatar)
        .refine(isLauncherAvatar, 'Use a built-in image or an http(s) image address.')
        .default(''),
    })
    .default({}),
  animation: z.enum(LAUNCHER_ANIMATIONS).default('none'),
  /** The unread dot on a website chat bot's closed launcher. */
  badge: z.boolean().default(true),
  chat: widgetChatOptionsSchema.default({}),
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
  botName: z.string(),
  subHeader: z.string(),
  ctaText: z.string(),
  popup: z.object({
    enabled: z.boolean(),
    position: z.enum(POPUP_POSITIONS),
    style: z.enum(POPUP_STYLES),
    text: z.string(),
    image: z.string(),
  }),
  animation: z.enum(LAUNCHER_ANIMATIONS),
  badge: z.boolean(),
  chat: z.object({
    fill: z.enum(CHAT_FILLS),
    shape: z.enum(CHAT_SHAPES),
    font: z.enum(CHAT_FONTS),
    size: z.enum(CHAT_SIZES),
    header: z.enum(CHAT_HEADERS),
    direction: z.enum(CHAT_DIRECTIONS),
    icons: z.boolean(),
    suggestions: z.array(z.string()),
    suggestionNodes: z.array(z.string()),
    suggestionsOn: z.boolean(),
    actions: z.boolean(),
    expand: z.boolean(),
    voice: z.boolean(),
    logo: z.string(),
    avatar: z.string(),
    background: z.string(),
    corner: z.enum(CHAT_CORNERS),
    autoOpen: z.number().int(),
    sound: z.boolean(),
    notice: z.object({
      enabled: z.boolean(),
      icon: chatNoticeIcon,
      items: z.array(chatNoticeItemSchema),
    }),
    quickMenu: z.object({
      enabled: z.boolean(),
      view: z.enum(CHAT_MENU_VIEWS),
      items: z.array(chatMenuItemSchema),
    }),
    banners: z.object({ enabled: z.boolean(), items: z.array(chatBannerItemSchema) }),
    fontSize: z.number().int(),
    hoverBg: z.string(),
    soundVolume: z.number().int(),
    speak: z.boolean(),
    pip: z.boolean(),
    feedback: z.object({ enabled: z.boolean(), message: z.string() }),
    languages: z.object({ primary: z.string(), additional: z.array(z.string()) }),
    devices: z.object({ desktop: z.boolean(), tablet: z.boolean(), mobile: z.boolean() }),
  }),
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
  bot_name: z.string(),
  sub_header: z.string(),
  cta_text: z.string(),
  popup: z.object({
    enabled: z.boolean(),
    position: z.enum(POPUP_POSITIONS),
    style: z.enum(POPUP_STYLES),
    text: z.string(),
    image_url: z.string(),
  }),
  animation: z.enum(LAUNCHER_ANIMATIONS),
  badge: z.boolean(),
  chat: z.object({
    fill: z.enum(CHAT_FILLS),
    shape: z.enum(CHAT_SHAPES),
    font: z.enum(CHAT_FONTS),
    size: z.enum(CHAT_SIZES),
    header: z.enum(CHAT_HEADERS),
    direction: z.enum(CHAT_DIRECTIONS),
    icons: z.boolean(),
    suggestions: z.array(z.string()),
    suggestionNodes: z.array(z.string()),
    suggestionsOn: z.boolean(),
    actions: z.boolean(),
    expand: z.boolean(),
    voice: z.boolean(),
    logo: z.string(),
    avatar: z.string(),
    background: z.string(),
    corner: z.enum(CHAT_CORNERS),
    autoOpen: z.number().int(),
    sound: z.boolean(),
    notice: z.object({
      enabled: z.boolean(),
      icon: chatNoticeIcon,
      items: z.array(chatNoticeItemSchema),
    }),
    quickMenu: z.object({
      enabled: z.boolean(),
      view: z.enum(CHAT_MENU_VIEWS),
      items: z.array(chatMenuItemSchema),
    }),
    banners: z.object({ enabled: z.boolean(), items: z.array(chatBannerItemSchema) }),
    fontSize: z.number().int(),
    hoverBg: z.string(),
    soundVolume: z.number().int(),
    speak: z.boolean(),
    pip: z.boolean(),
    feedback: z.object({ enabled: z.boolean(), message: z.string() }),
    languages: z.object({ primary: z.string(), additional: z.array(z.string()) }),
    devices: z.object({ desktop: z.boolean(), tablet: z.boolean(), mobile: z.boolean() }),
  }),
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
    bot_name: l.botName,
    sub_header: l.subHeader,
    cta_text: l.ctaText,
    popup: {
      enabled: l.popup.enabled,
      position: l.popup.position,
      style: l.popup.style,
      text: l.popup.text,
      image_url: l.popup.image === '' ? '' : launcherAvatarSrc(l.popup.image),
    },
    animation: l.animation,
    badge: l.badge,
    chat: JSON.parse(JSON.stringify(l.chat)) as typeof l.chat,
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
  /** Builder preview only: Start Conversation keeps its normal look and does nothing when there is no link. */
  inertStart?: boolean;
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

  function rgba(hex, a) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  var style = d.createElement('style');
  function place(dev, p) {
    return '.' + K + '[data-dev="' + dev + '"]{' + (p.side === 'left' ? 'left:' + p.s + 'px;right:auto;align-items:flex-start;' : 'right:' + p.s + 'px;left:auto;align-items:flex-end;') + 'bottom:' + p.b + 'px;--wb:' + p.b + 'px}';
  }
  style.textContent = '.' + K + '{position:fixed;z-index:2147483600;display:flex;flex-direction:column;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.35}'
    + '.' + K + ' *{box-sizing:border-box}'
    + place('d', C.desktop) + place('m', C.mobile)
    + '.' + K + ' button{font-family:inherit}'
    + '.' + K + ' button:focus-visible{outline:3px solid #fff;box-shadow:0 0 0 5px #1d4ed8}'
    + '@keyframes ' + K + '-bounce{0%,20%,50%,80%,100%{transform:translateY(0)}40%{transform:translateY(-12px)}60%{transform:translateY(-6px)}}'
    + '@keyframes ' + K + '-ripple{0%{box-shadow:0 8px 26px rgba(0,0,0,.25),0 0 0 0 ' + rgba(C.from, .55) + '}100%{box-shadow:0 8px 26px rgba(0,0,0,.25),0 0 0 20px ' + rgba(C.from, 0) + '}}'
    + '@media (prefers-reduced-motion:reduce){.' + K + ' button{animation:none!important}}';
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
  // Tall like the real thing: 500px, shrinking only when the page is shorter (the launcher, the collapse button and the bottom spacing stay in view).
  var panel = el('div', 'display:none;flex-direction:column;width:360px;max-width:calc(100vw - 20px);height:min(500px,calc(100vh - 100px - var(--wb,10px)));min-height:240px;margin-bottom:12px;border-radius:20px;overflow:hidden;background:#EDE8E0;box-shadow:0 14px 48px rgba(0,0,0,.28)');
  panel.id = 'wgt-panel-' + C.id;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', C.name);

  var head = el('div', 'display:flex;align-items:center;gap:14px;padding:16px 18px;color:#fff;flex:none;background:' + grad);
  var avatar = el('img', 'width:52px;height:52px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.9);background:#fff;flex:none');
  avatar.alt = '';
  avatar.src = C.avatar;
  var who = el('div', 'min-width:0');
  var title = el('div', 'font-size:17px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', C.name);
  title.setAttribute('data-testid', 'wgt-name');
  var reply = el('div', 'font-size:12.5px;font-weight:700;margin-top:3px;opacity:.95', C.text.reply);
  who.appendChild(title);
  who.appendChild(reply);
  head.appendChild(avatar);
  head.appendChild(who);

  var body = el('div', 'flex:1;overflow:auto;padding:20px 16px;background:#EDE8E0');
  var bubble = el('div', 'position:relative;display:inline-block;max-width:88%;background:#fff;color:#111b21;border-radius:0 12px 12px 12px;padding:9px 12px 22px;font-size:14.5px;box-shadow:0 1px 1px rgba(0,0,0,.13);overflow-wrap:anywhere;white-space:pre-wrap');
  bubble.setAttribute('data-testid', 'wgt-intro');
  var tail = el('span', 'position:absolute;left:-7px;top:0;width:0;height:0;border-top:9px solid #fff;border-left:8px solid transparent');
  var greet = el('div', 'font-weight:700;margin-bottom:3px', C.greeting);
  greet.setAttribute('data-testid', 'wgt-greeting');
  var introText = el('div', '', C.intro);
  var time = el('span', 'position:absolute;right:10px;bottom:5px;font-size:11px;color:#667781');
  try { time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); } catch (e) { time.textContent = ''; }
  bubble.appendChild(tail);
  if (C.greeting) bubble.appendChild(greet);
  bubble.appendChild(introText);
  bubble.appendChild(time);
  body.appendChild(bubble);

  var foot = el('div', 'flex:none;padding:14px 16px 16px;border-top:1px solid #d6cfc3;background:#EDE8E0');
  var start = el('button', 'width:100%;height:52px;border:0;border-radius:26px;color:#fff;font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;background:' + grad);
  start.type = 'button';
  start.id = 'wgt-start-' + C.id;
  start.setAttribute('data-testid', 'wgt-start');
  start.setAttribute('data-wa', C.wa || '');
  start.appendChild(svg(SEND, 19));
  start.appendChild(el('span', '', C.text.start));
  if (C.wa) {
    start.addEventListener('click', function () { win.open(C.wa, '_blank', 'noopener'); });
  } else if (!C.inert) {
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
  if (C.animation === 'bounce') launch.style.animation = K + '-bounce 2.2s ease-in-out infinite';
  else if (C.animation === 'ripple') launch.style.animation = K + '-ripple 1.8s ease-out infinite';

  // --- the popup: a small bubble beside or above the closed launcher, dismissed for the rest of the visit
  var dismissed = false;
  try { dismissed = !C.preview && win.sessionStorage.getItem(K + '-pop') === '1'; } catch (e) { dismissed = false; }
  var pop = null;
  if (C.popup.enabled) {
    pop = el('div', 'position:relative;display:flex;align-items:center;gap:10px;max-width:260px;background:#fff;color:#111b21;border-radius:14px;padding:10px 30px 10px 12px;box-shadow:0 8px 26px rgba(0,0,0,.2);font-size:14px;overflow-wrap:anywhere');
    pop.setAttribute('data-testid', 'wgt-popup');
    pop.setAttribute('role', 'status');
    if (C.popup.image) {
      var popImg = el('img', 'width:36px;height:36px;border-radius:50%;object-fit:cover;flex:none');
      popImg.alt = '';
      popImg.src = C.popup.image;
      pop.appendChild(popImg);
    }
    pop.appendChild(el('span', '', C.popup.text));
    var popX = el('button', 'position:absolute;top:4px;right:6px;border:0;background:transparent;cursor:pointer;font-size:16px;line-height:1;color:#667781;padding:2px 4px');
    popX.type = 'button';
    popX.setAttribute('data-testid', 'wgt-popup-close');
    popX.setAttribute('aria-label', C.text.dismiss);
    popX.textContent = '\u00d7';
    popX.addEventListener('click', function () {
      dismissed = true;
      try { win.sessionStorage.setItem(K + '-pop', '1'); } catch (e) {}
      syncPop();
    });
    pop.appendChild(popX);
  }
  var dock = el('div', 'display:flex;align-items:center;gap:10px');
  if (pop) dock.appendChild(pop);
  dock.appendChild(launch);

  var close = el('button', 'display:none;border:0;cursor:pointer;width:50px;height:50px;padding:0;border-radius:50%;align-items:center;justify-content:center;box-shadow:0 8px 26px rgba(0,0,0,.25);background:' + grad);
  close.type = 'button';
  close.id = 'wgt-close-' + C.id;
  close.setAttribute('data-testid', 'wgt-close');
  close.setAttribute('aria-label', C.text.close);
  close.appendChild(svg(DOWN, 26));

  wrap.appendChild(panel);
  wrap.appendChild(dock);
  wrap.appendChild(close);
  d.body.appendChild(wrap);

  var open = false;
  function syncPop() { if (pop) pop.style.display = !open && !dismissed ? 'flex' : 'none'; }
  function show(next) {
    open = next;
    panel.style.display = open ? 'flex' : 'none';
    launch.style.display = open ? 'none' : 'flex';
    close.style.display = open ? 'flex' : 'none';
    launch.setAttribute('aria-expanded', open ? 'true' : 'false');
    syncPop();
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
  function apply() {
    wrap.setAttribute('data-dev', device());
    // The popup sits above the launcher, or beside it on the side the page has room for (left of a right-hand launcher).
    var side = (device() === 'm' ? C.mobile : C.desktop).side;
    if (C.popup.position === 'side') {
      dock.style.flexDirection = side === 'left' ? 'row-reverse' : 'row';
    } else {
      dock.style.flexDirection = 'column';
      dock.style.alignItems = side === 'left' ? 'flex-start' : 'flex-end';
    }
  }
  apply();
  if (mq && C.device === 'auto') { if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply); }

  if (C.startOpen) { panel.style.display = 'flex'; launch.style.display = 'none'; close.style.display = 'flex'; open = true; launch.setAttribute('aria-expanded', 'true'); }
  else if (C.autoOpen) setTimeout(function () { if (!open) show(true); }, 1200);
  syncPop();
})
`;

/** The loader of a WhatsApp-mode widget: draws the launcher and the messenger panel directly on the host page. */
export function buildLauncherScript(i: LauncherScriptInput): string {
  const colour = resolveLauncherColour(i.launcher.colour);
  const data = {
    guard: `__wgtWidget_${i.id}`,
    id: i.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 12),
    // The header shows the name set for the button, else the bot's own.
    name: i.launcher.botName || i.name,
    type: i.launcher.buttonType,
    animation: i.launcher.animation,
    popup: {
      enabled: i.launcher.popup.enabled && i.launcher.popup.text !== '',
      position: i.launcher.popup.position,
      text: i.launcher.popup.text,
      image: i.launcher.popup.image === '' ? '' : launcherAvatarSrc(i.launcher.popup.image),
    },
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
    inert: i.inertStart === true,
    text: {
      pill: LAUNCHER_TEXT.pill,
      open: LAUNCHER_TEXT.openLabel,
      close: LAUNCHER_TEXT.closeLabel,
      dismiss: LAUNCHER_TEXT.dismissLabel,
      reply: i.launcher.subHeader,
      start: i.launcher.ctaText,
      noNumber: LAUNCHER_TEXT.noNumber,
    },
  };
  return `${RUNTIME.trim()}(${literal(data)});\n`;
}
