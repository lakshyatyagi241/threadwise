/// <reference lib="dom" />
/**
 * The Carousel step of a website chat bot: a row of cards the visitor scrolls through, each with a picture, a title, a line of text and
 * up to two buttons. A button either REPLIES (the visitor's tap continues the flow down that button's own exit) or OPENS something
 * outside the chat (a page, a phone call, an email). Not a Reference node: the website chat window is built here (the old console's
 * "Carousel" node for its web bot is the model). One place holds the limits and the card shape so the editor, the compiler and the
 * runtime agree on them.
 */

export const FLB_CAROUSEL_MAX_CARDS = 10;
export const FLB_CAROUSEL_MAX_BUTTONS = 2;
export const FLB_CAROUSEL_LIMITS = { title: 60, text: 200, label: 20, intro: 400 } as const;

export const FLB_CAROUSEL_BUTTON_TYPES = ['reply', 'agent', 'url', 'phone', 'email'] as const;
export type FlbCarouselButtonType = (typeof FLB_CAROUSEL_BUTTON_TYPES)[number];

export interface FlbCarouselButton {
  type: FlbCarouselButtonType;
  label: string;
  /** The address for a page, a phone number or an email; empty for a reply and for a hand-over. */
  value: string;
  /** A hand-over (`agent`) button: the team that takes the conversation, and the note it is given. */
  team?: string;
  note?: string;
}

export interface FlbCarouselCard {
  /** A picture address (`https://`); empty for a card without a picture. */
  image: string;
  title: string;
  text: string;
  buttons: FlbCarouselButton[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};

/** The cards as saved, cleaned: known button types, the limits applied, at most ten cards of two buttons. */
export function flbCleanCarouselCards(raw: unknown): FlbCarouselCard[] {
  return (Array.isArray(raw) ? raw : []).slice(0, FLB_CAROUSEL_MAX_CARDS).map((c) => {
    const card = rec(c);
    return {
      image: str(card.image).trim(),
      title: str(card.title).slice(0, FLB_CAROUSEL_LIMITS.title),
      text: str(card.text).slice(0, FLB_CAROUSEL_LIMITS.text),
      buttons: (Array.isArray(card.buttons) ? card.buttons : [])
        .slice(0, FLB_CAROUSEL_MAX_BUTTONS)
        .map((b) => {
          const btn = rec(b);
          const type = (FLB_CAROUSEL_BUTTON_TYPES as readonly string[]).includes(str(btn.type))
            ? (str(btn.type) as FlbCarouselButtonType)
            : 'reply';
          return {
            type,
            label: str(btn.label).slice(0, FLB_CAROUSEL_LIMITS.label),
            value: type === 'reply' || type === 'agent' ? '' : str(btn.value).trim(),
            ...(type === 'agent'
              ? { team: str(btn.team).trim(), note: str(btn.note).slice(0, 500) }
              : {}),
          };
        }),
    };
  });
}

/**
 * The buttons that reply (a plain reply or a hand-over to a person), in card order: the flow leaves a Carousel by one exit per reply button (`p0`, `p1`, ...), so the position here
 * IS the exit. `card` and `button` say where each one sits.
 */
export function flbCarouselReplies(
  raw: unknown,
): Array<{ label: string; card: number; button: number }> {
  const out: Array<{ label: string; card: number; button: number }> = [];
  flbCleanCarouselCards(raw).forEach((c, ci) =>
    c.buttons.forEach((b, bi) => {
      if (b.type === 'reply' || b.type === 'agent')
        out.push({ label: b.label, card: ci, button: bi });
    }),
  );
  return out;
}

/** True when `url` is a picture address the chat window may load. */
export const flbCarouselImageOk = (url: string): boolean => /^https?:\/\/\S+$/i.test(url.trim());

/**
 * A picture address the chat can use: an http(s) link, with spaces and other characters a browser would write as %XX written that way
 * (a camera's `IMG 1234.JPG` is a usual name). Null for anything else, so a card without a usable picture shows without one.
 */
export function flbImageUrl(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s === '') return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
