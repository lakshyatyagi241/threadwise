import {
  CONTACT_CARDS_MAX,
  INTERACTIVE_BODY_MAX,
  INTERACTIVE_BUTTON_TITLE_MAX,
  INTERACTIVE_BUTTONS_MAX,
  INTERACTIVE_FOOTER_MAX,
  INTERACTIVE_HEADER_MAX,
  LIST_ROWS_MAX,
  LIST_ROW_DESCRIPTION_MAX,
  LIST_ROW_TITLE_MAX,
  LIST_SECTIONS_MAX,
  LIST_SECTION_TITLE_MAX,
  type SendMessageInput,
} from '@crm/contracts';

/** What the "Share" dialog of the composer sends: a place, contact cards or buttons (no client id yet: the thread adds it). */
export type ShareInput =
  Extract<SendMessageInput, { kind: 'location' | 'contacts' | 'interactive' }> extends infer T
    ? T extends unknown
      ? Omit<T, 'clientMessageId' | 'replyToMessageId'>
      : never
    : never;

export type Built<T> = { ok: true; input: T } | { ok: false; problems: Record<string, string> };

const clean = (v: string) => v.trim();

// --- location ---------------------------------------------------------------------------------------------------------

export interface LocationForm {
  latitude: string;
  longitude: string;
  name: string;
  address: string;
}
export const EMPTY_LOCATION: LocationForm = { latitude: '', longitude: '', name: '', address: '' };

/** A decimal degree, with a comma accepted as the separator ("28,6139"). Null when it is not a number. */
export function parseDegrees(raw: string): number | null {
  const v = clean(raw).replace(',', '.');
  if (v === '' || !/^[+-]?\d+(\.\d+)?$/.test(v)) return null;
  return Number(v);
}

/**
 * Pasting what Google Maps copies ("28.6139, 77.2090") into the first box fills both: returns the pair, or null when the text is
 * not two numbers.
 */
export function splitPair(raw: string): [string, string] | null {
  const m = /^\s*([+-]?\d+(?:\.\d+)?)\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)\s*$/.exec(raw);
  return m ? [m[1]!, m[2]!] : null;
}

export function buildLocation(f: LocationForm): Built<ShareInput> {
  const problems: Record<string, string> = {};
  const latitude = parseDegrees(f.latitude);
  const longitude = parseDegrees(f.longitude);
  if (latitude === null) problems.latitude = 'required';
  else if (latitude < -90 || latitude > 90) problems.latitude = 'range';
  if (longitude === null) problems.longitude = 'required';
  else if (longitude < -180 || longitude > 180) problems.longitude = 'range';
  if (Object.keys(problems).length || latitude === null || longitude === null) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    input: {
      kind: 'location',
      latitude,
      longitude,
      ...(clean(f.name) ? { name: clean(f.name).slice(0, 255) } : {}),
      ...(clean(f.address) ? { address: clean(f.address).slice(0, 500) } : {}),
    },
  };
}

// --- contacts ---------------------------------------------------------------------------------------------------------

export interface ContactForm {
  name: string;
  phone: string;
  email: string;
  org: string;
}
export const EMPTY_CONTACT: ContactForm = { name: '', phone: '', email: '', org: '' };
export { CONTACT_CARDS_MAX };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function buildContacts(cards: ContactForm[]): Built<ShareInput> {
  const problems: Record<string, string> = {};
  cards.forEach((c, i) => {
    if (clean(c.name) === '') problems[`${i}.name`] = 'required';
    if (clean(c.phone) === '' && clean(c.email) === '') problems[`${i}.phone`] = 'phoneOrEmail';
    else if (clean(c.phone) !== '' && !/^\+?[\d\s().-]{3,32}$/.test(clean(c.phone)))
      problems[`${i}.phone`] = 'phone';
    if (clean(c.email) !== '' && !EMAIL.test(clean(c.email))) problems[`${i}.email`] = 'email';
  });
  if (Object.keys(problems).length) return { ok: false, problems };
  return {
    ok: true,
    input: {
      kind: 'contacts',
      contacts: cards.map((c) => ({
        name: clean(c.name).slice(0, 200),
        phones: clean(c.phone) ? [clean(c.phone)] : [],
        emails: clean(c.email) ? [clean(c.email)] : [],
        ...(clean(c.org) ? { org: clean(c.org).slice(0, 200) } : {}),
      })),
    },
  };
}

// --- buttons ----------------------------------------------------------------------------------------------------------

export interface ListSectionForm {
  title: string;
  rows: { title: string; description: string }[];
}

export interface ButtonsForm {
  type: 'buttons' | 'cta_url' | 'list';
  body: string;
  header: string;
  footer: string;
  /** Reply button titles (`buttons`). */
  titles: string[];
  /** The link button (`cta_url`). */
  linkText: string;
  url: string;
  /** The button that opens a list (`list`) and its sections. */
  listButton: string;
  sections: ListSectionForm[];
}
export const EMPTY_SECTION: ListSectionForm = { title: '', rows: [{ title: '', description: '' }] };
export const EMPTY_BUTTONS: ButtonsForm = {
  type: 'buttons',
  body: '',
  header: '',
  footer: '',
  titles: ['', ''],
  linkText: '',
  url: '',
  listButton: '',
  sections: [EMPTY_SECTION],
};
export const BUTTON_LIMITS = {
  body: INTERACTIVE_BODY_MAX,
  header: INTERACTIVE_HEADER_MAX,
  footer: INTERACTIVE_FOOTER_MAX,
  title: INTERACTIVE_BUTTON_TITLE_MAX,
  max: INTERACTIVE_BUTTONS_MAX,
  rows: LIST_ROWS_MAX,
  sections: LIST_SECTIONS_MAX,
  rowTitle: LIST_ROW_TITLE_MAX,
  rowDescription: LIST_ROW_DESCRIPTION_MAX,
  sectionTitle: LIST_SECTION_TITLE_MAX,
} as const;

/** Rows filled in, across every section (WhatsApp counts them together). */
export const listRowCount = (sections: ListSectionForm[]): number =>
  sections.reduce((n, s) => n + s.rows.filter((r) => clean(r.title) !== '').length, 0);

export function buildButtons(f: ButtonsForm): Built<ShareInput> {
  const problems: Record<string, string> = {};
  if (clean(f.body) === '') problems.body = 'required';
  const common = {
    body: clean(f.body),
    ...(clean(f.header) ? { header: clean(f.header) } : {}),
    ...(clean(f.footer) ? { footer: clean(f.footer) } : {}),
  };
  if (f.type === 'list') {
    if (clean(f.listButton) === '') problems.listButton = 'required';
    const sections = f.sections
      .map((sec, si) => ({
        si,
        title: clean(sec.title),
        rows: sec.rows
          .map((r, ri) => ({ ri, title: clean(r.title), description: clean(r.description) }))
          .filter((r) => r.title !== ''),
      }))
      .filter((sec) => sec.rows.length > 0);
    const total = sections.reduce((n, sec) => n + sec.rows.length, 0);
    if (total === 0) problems['row.0.0'] = 'required';
    else if (total > LIST_ROWS_MAX) problems.rows = 'tooManyRows';
    if (sections.length > 1 && sections.some((sec) => sec.title === '')) {
      // WhatsApp needs a title on every section once there is more than one.
      for (const sec of sections) if (sec.title === '') problems[`section.${sec.si}`] = 'required';
    }
    if (Object.keys(problems).length) return { ok: false, problems };
    return {
      ok: true,
      input: {
        kind: 'interactive',
        interactive: {
          type: 'list',
          ...common,
          button: clean(f.listButton),
          sections: sections.map((sec) => ({
            ...(sec.title ? { title: sec.title } : {}),
            rows: sec.rows.map((r) => ({
              title: r.title,
              ...(r.description ? { description: r.description } : {}),
            })),
          })),
        },
      },
    };
  }
  if (f.type === 'cta_url') {
    if (clean(f.linkText) === '') problems.linkText = 'required';
    if (clean(f.url) === '') problems.url = 'required';
    else if (!/^https?:\/\/\S+$/i.test(clean(f.url))) problems.url = 'url';
    if (Object.keys(problems).length) return { ok: false, problems };
    return {
      ok: true,
      input: {
        kind: 'interactive',
        interactive: { type: 'cta_url', ...common, text: clean(f.linkText), url: clean(f.url) },
      },
    };
  }
  const titles = f.titles.map(clean);
  if (titles.every((t) => t === '')) problems['title.0'] = 'required';
  const seen = new Set<string>();
  titles.forEach((t, i) => {
    if (t === '') return;
    // WhatsApp refuses two buttons with the same title.
    if (seen.has(t.toLowerCase())) problems[`title.${i}`] = 'duplicate';
    seen.add(t.toLowerCase());
  });
  if (Object.keys(problems).length) return { ok: false, problems };
  return {
    ok: true,
    input: {
      kind: 'interactive',
      interactive: {
        type: 'buttons',
        ...common,
        buttons: titles.filter((t) => t !== '').map((title) => ({ title })),
      },
    },
  };
}
