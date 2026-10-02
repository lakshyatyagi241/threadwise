/**
 * The pure rules of link tracking (TW-BCAST-018).
 */
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A random base62 token. `random` is injectable so a test can force a collision. */
export function makeToken(
  length: number,
  random: (max: number) => number = (m) => Math.floor(Math.random() * m),
): string {
  let out = '';
  for (let i = 0; i < length; i++) out += BASE62[random(BASE62.length)];
  return out;
}

/** What the public route accepts before it touches the database. */
export const isTokenShape = (t: string) => /^[A-Za-z0-9]{8,32}$/.test(t);

/** Only http and https links are wrapped; anything else (tel:, mailto:, javascript:) is left as it is. */
export function isTrackableUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Link-preview crawlers and tools fetch a link without a person tapping it; they are redirected but not counted. */
const BOT_MARKERS = [
  'whatsapp',
  'facebook',
  'meta-externalfetcher',
  'twitterbot',
  'linkedinbot',
  'slackbot',
  'googlebot',
  'bingbot',
  'discordbot',
  'embedly',
  'curl/',
  'wget/',
  'python-requests',
];
export const isBot = (userAgent: string | null | undefined) => {
  const ua = (userAgent ?? '').toLowerCase();
  return BOT_MARKERS.some((m) => ua.includes(m));
};

/** Days a link lives: the setting, never below 7. */
export const linkTtlDays = (setting: number) => Math.max(7, Math.trunc(setting) || 90);

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/gi;
const TRAILING = /[.,;:!?)\]}]+$/;

/**
 * Replaces every http(s) link in a text with `wrap(url)`. Sentence punctuation stuck to the end of a link is not part of
 * it. Used for the text-body engines (Baileys, Twilio), where each recipient gets a body with their own short links.
 */
export async function replaceUrlsInText(
  text: string,
  wrap: (url: string) => Promise<string>,
): Promise<string> {
  const matches = [...text.matchAll(URL_IN_TEXT)];
  if (matches.length === 0) return text;
  let out = '';
  let last = 0;
  for (const m of matches) {
    const raw = m[0];
    const tail = TRAILING.exec(raw)?.[0] ?? '';
    const url = tail ? raw.slice(0, -tail.length) : raw;
    out += text.slice(last, m.index) + (await wrap(url)) + tail;
    last = m.index! + raw.length;
  }
  return out + text.slice(last);
}
