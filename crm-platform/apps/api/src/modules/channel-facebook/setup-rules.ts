/** Pure rules of the Messenger profile (WD-FB-015): reading what Meta returns and building what it accepts. */

/** Meta caps. */
export const GREETING_LIMIT = 160;
export const MENU_ITEM_LIMIT = 3;
export const MENU_TITLE_LIMIT = 30;
export const ICE_BREAKER_LIMIT = 4;
export const ICE_QUESTION_LIMIT = 80;
/** A persistent menu needs a Get Started button; when there is none this one is made. */
export const DEFAULT_GET_STARTED = 'GET_STARTED';

/** What Meta says when the Graph version in use has dropped the welcome greeting. */
export const GREETING_UNSUPPORTED_MESSAGE =
  'Facebook no longer accepts the Messenger welcome greeting on this API version. Use Ice breakers instead — they show tappable questions on the same welcome screen.';

type Dict = Record<string, unknown>;
const dict = (x: unknown): Dict => (typeof x === 'object' && x !== null ? (x as Dict) : {});
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string =>
  typeof x === 'string' || typeof x === 'number' ? String(x) : '';
const clip = (s: string, n: number): string => Array.from(s).slice(0, n).join('');

export interface MenuItemView {
  title: string;
  type: 'web_url' | 'postback';
  url: string;
  payload: string;
}

export interface ProfileView {
  getStarted: string;
  greeting: string;
  menuItems: MenuItemView[];
  composerDisabled: boolean;
  iceBreakers: Array<{ question: string; payload: string }>;
}

/**
 * The profile as the screen shows it. Meta returns a list of one-property objects (already merged by the client). A greeting is the
 * `default` locale's text (Meta always stores one), else the last text seen. The menu is the `default` locale block, else the first.
 * Ice breakers come in the localized shape (`call_to_actions` per locale) or the older flat list of `{question, payload}`.
 */
export function readProfile(profile: Dict): ProfileView {
  let greeting = '';
  for (const g of list(profile.greeting).map(dict)) {
    if (g.locale === 'default') {
      greeting = str(g.text);
      break;
    }
    greeting = str(g.text) || greeting;
  }

  const blocks = list(profile.persistent_menu).map(dict);
  const block = blocks.find((b) => b.locale === 'default') ?? blocks[0];
  const menuItems: MenuItemView[] = list(block?.call_to_actions)
    .map(dict)
    .map((cta) => ({
      title: str(cta.title),
      type: cta.type === 'web_url' ? 'web_url' : 'postback',
      url: str(cta.url),
      payload: str(cta.payload),
    }));

  const raw = list(profile.ice_breakers);
  const localized = raw.map(dict).find((b) => b.locale === 'default');
  const first = dict(raw[0]);
  const source = localized?.call_to_actions
    ? list(localized.call_to_actions)
    : first.call_to_actions
      ? list(first.call_to_actions)
      : raw;
  const iceBreakers = source
    .filter((x) => typeof x === 'object' && x !== null)
    .map((x) => ({ question: str(dict(x).question), payload: str(dict(x).payload) }));

  return {
    getStarted: str(dict(profile.get_started).payload),
    greeting,
    menuItems,
    composerDisabled: block?.composer_input_disabled === true,
    iceBreakers,
  };
}

/** The greeting Meta takes: trimmed and cut to 160 characters. */
export const greetingText = (raw: string): string => clip(raw.trim(), GREETING_LIMIT);

export type CallToAction =
  | { type: 'web_url'; title: string; url: string; webview_height_ratio: 'full' }
  | { type: 'postback'; title: string; payload: string };

/**
 * The persistent menu's items as Meta takes them (WaDesk's rules): rows without a title are skipped; a link needs its address or
 * the row is skipped; a tap with no payload gets `MENU_<n>` where n is the row's place in what was posted; titles are cut to 30;
 * at most three items.
 */
export function buildMenu(
  items: ReadonlyArray<{ title: string; type: string; url: string; payload: string }>,
): CallToAction[] {
  const out: CallToAction[] = [];
  for (const [i, item] of items.entries()) {
    const title = item.title.trim();
    if (title === '') continue;
    if (item.type === 'web_url') {
      const url = item.url.trim();
      if (url === '') continue;
      out.push({
        type: 'web_url',
        title: clip(title, MENU_TITLE_LIMIT),
        url,
        webview_height_ratio: 'full',
      });
    } else {
      const payload = item.payload.trim();
      out.push({
        type: 'postback',
        title: clip(title, MENU_TITLE_LIMIT),
        payload: payload !== '' ? payload : `MENU_${i + 1}`,
      });
    }
    if (out.length >= MENU_ITEM_LIMIT) break;
  }
  return out;
}

/** The ice breakers Meta takes: blank questions are skipped, questions cut to 80, a blank payload becomes `ICE_BREAKER_<n>`, at most four. */
export function buildIceBreakers(
  items: ReadonlyArray<{ question: string; payload: string }>,
): Array<{ question: string; payload: string }> {
  const out: Array<{ question: string; payload: string }> = [];
  for (const [i, item] of items.entries()) {
    const question = item.question.trim();
    if (question === '') continue;
    const payload = item.payload.trim();
    out.push({
      question: clip(question, ICE_QUESTION_LIMIT),
      payload: payload !== '' ? payload : `ICE_BREAKER_${i + 1}`,
    });
    if (out.length >= ICE_BREAKER_LIMIT) break;
  }
  return out;
}

/**
 * True when Meta's error means "this endpoint does not know the `greeting` field" rather than a real failure. It is read from the list of
 * accepted params Meta echoes back: if it lists what it takes and `greeting` is not among them, the field is gone on this version. Narrow
 * on purpose: a bad token or a missing permission must never be swallowed as "unsupported".
 */
export function greetingUnsupported(error: string): boolean {
  if (error === '' || !error.includes('Requires one of the params')) return false;
  return !/\bgreeting\b/i.test(error);
}

/** "Facebook rejected the change: …". */
export const rejectedMessage = (reason: string | undefined): string =>
  `Facebook rejected the change: ${reason || 'unknown error'}`;
