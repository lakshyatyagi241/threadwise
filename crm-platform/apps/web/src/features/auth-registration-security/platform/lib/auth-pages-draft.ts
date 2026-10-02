import {
  AUTH_PAGE_EXTRA_KEYS,
  authPageContentPatchSchema,
  type AuthPageContent,
  type AuthPageName,
  type AuthPagesPatch,
  type AuthPagesResponse,
} from '@crm/contracts';

/** The shipped copy and accent per page, as the API reports them (`defaults` of the auth pages response). */
export type PageDefaults = AuthPagesResponse['defaults'];

export const PAGES = ['login', 'register', 'forgot'] as const satisfies readonly AuthPageName[];
/**
 * Every page can carry showcase copy. Login shows all of it on the split design; register stores the
 * same keys (a superset of what WaDesk edits there); forgot has a hero card and a footer line.
 */
export const SHOWCASE_PAGES = ['login', 'register', 'forgot'] as const;
export type ShowcasePage = (typeof SHOWCASE_PAGES)[number];

export type ShowcaseGroup = 'hero' | 'stats' | 'features' | 'chips' | 'footer';
/** Which blocks of showcase fields the editor offers per page. */
export const SHOWCASE_GROUPS_BY_PAGE: Record<ShowcasePage, readonly ShowcaseGroup[]> = {
  login: ['hero', 'stats', 'features', 'chips', 'footer'],
  register: ['hero', 'stats', 'features', 'chips', 'footer'],
  forgot: ['hero', 'footer'],
};
export const VARIANT_IDS = [1, 2, 3, 4, 5] as const;

export const TEXT_FIELDS = ['eyebrow', 'heading', 'headingAccent', 'subheading'] as const;
export type TextField = (typeof TEXT_FIELDS)[number];
export const TEXT_LIMITS: Record<TextField, number> = {
  eyebrow: 120,
  heading: 120,
  headingAccent: 120,
  subheading: 400,
};
export const EXTRA_LIMIT = 600;
export const MEDIA_URL_LIMIT = 2048;
export type MediaType = NonNullable<AuthPageContent['mediaType']>;
export const MEDIA_TYPES: readonly MediaType[] = ['image', 'gif', 'video'];

/** The showcase copy keys, grouped the way the editor lays them out. */
export const SHOWCASE_GROUPS = {
  hero: ['hero_title', 'hero_desc'],
  stats: ['stat1_num', 'stat1_label', 'stat2_num', 'stat2_label', 'stat3_num', 'stat3_label'],
  features: [
    'feat1_title',
    'feat1_desc',
    'feat2_title',
    'feat2_desc',
    'feat3_title',
    'feat3_desc',
    'feat4_title',
    'feat4_desc',
  ],
  chips: ['inside_heading', 'chip1', 'chip2', 'chip3', 'chip4', 'chip5', 'chip6'],
  footer: ['footer'],
} as const;

export interface PageDraft {
  eyebrow: string;
  heading: string;
  headingAccent: string;
  subheading: string;
  /** '' = the shipped accent. */
  accent: string;
  mediaUrl: string;
  mediaType: MediaType;
}
export interface AuthPagesDraft {
  variant: number;
  pages: Record<AuthPageName, PageDraft>;
  extra: Record<ShowcasePage, Record<string, string>>;
}

/** The pages' public links: opened in a new tab beside the preview. */
export const REAL_PAGE_PATHS: Record<AuthPageName, string> = {
  login: '/login',
  register: '/signup',
  forgot: '/forgot-password',
};

function pageToDraft(c: AuthPageContent): PageDraft {
  return {
    eyebrow: c.eyebrow ?? '',
    heading: c.heading ?? '',
    headingAccent: c.headingAccent ?? '',
    subheading: c.subheading ?? '',
    accent: c.accent ?? '',
    mediaUrl: c.mediaUrl ?? '',
    mediaType: c.mediaType ?? 'image',
  };
}

export function authPagesToDraft(r: AuthPagesResponse): AuthPagesDraft {
  return {
    variant: r.variant,
    pages: {
      login: pageToDraft(r.login),
      register: pageToDraft(r.register),
      forgot: pageToDraft(r.forgot),
    },
    extra: {
      login: { ...r.extra.login },
      register: { ...r.extra.register },
      // Older servers do not send the forgot page's copy.
      forgot: { ...(r.extra.forgot ?? {}) },
    },
  };
}

/** Video by extension, GIF by extension, otherwise a picture. */
export function guessMediaType(url: string): MediaType {
  const path = url.trim().split(/[?#]/)[0]!.toLowerCase();
  if (/\.(mp4|webm|ogg|mov)$/.test(path)) return 'video';
  if (path.endsWith('.gif')) return 'gif';
  return 'image';
}

export function isHttpsUrl(value: string): boolean {
  const v = value.trim();
  if (v.length === 0 || v.length > MEDIA_URL_LIMIT) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

/** A colour the `<input type=color>` can show: exactly #rrggbb. */
export const isHexColour = (v: string): boolean => /^#[0-9a-fA-F]{6}$/.test(v);

/** Whether the API takes this accent: asked of the contract, so the editor accepts exactly what it accepts. */
export const isAcceptedAccent = (v: string): boolean =>
  authPageContentPatchSchema.shape.accent.safeParse(v).success;

export type AuthPagesProblem = 'accent' | 'mediaUrl';
/** Keyed `<page>.<field>`. */
export type AuthPagesProblems = Record<string, AuthPagesProblem>;

export function buildAuthPagesPatch(
  base: AuthPagesResponse,
  draft: AuthPagesDraft,
): { patch: AuthPagesPatch; problems: AuthPagesProblems } {
  const patch: AuthPagesPatch = {};
  const problems: AuthPagesProblems = {};
  if (draft.variant !== base.variant) patch.variant = draft.variant;
  const clearMedia: AuthPageName[] = [];

  for (const page of PAGES) {
    const d = draft.pages[page];
    const b = base[page];
    const content: NonNullable<AuthPagesPatch['login']> = {};
    for (const f of TEXT_FIELDS) {
      const v = d[f].trim();
      if (v !== (b[f] ?? '')) content[f] = v;
    }

    const accent = d.accent.trim();
    if (accent && !isAcceptedAccent(accent)) problems[`${page}.accent`] = 'accent';
    else if (accent && accent.toLowerCase() !== (b.accent ?? '').toLowerCase())
      content.accent = accent.toLowerCase();
    // An empty accent clears the override, so visitors see the shipped colour again.
    else if (!accent && b.accent) content.accent = '';

    const url = d.mediaUrl.trim();
    if (!url) {
      if (b.mediaUrl) clearMedia.push(page);
    } else if (!isHttpsUrl(url)) {
      problems[`${page}.mediaUrl`] = 'mediaUrl';
    } else if (url !== b.mediaUrl || d.mediaType !== (b.mediaType ?? 'image')) {
      content.mediaUrl = url;
      content.mediaType = d.mediaType;
    }

    if (Object.keys(content).length > 0) patch[page] = content;
  }
  if (clearMedia.length > 0) patch.clearMedia = clearMedia;

  for (const page of SHOWCASE_PAGES) {
    const changed: Record<string, string> = {};
    for (const key of AUTH_PAGE_EXTRA_KEYS) {
      const v = (draft.extra[page][key] ?? '').trim();
      if (v !== (base.extra[page]?.[key] ?? '')) changed[key] = v;
    }
    if (Object.keys(changed).length > 0) patch.extra = { ...patch.extra, [page]: changed };
  }
  return { patch, problems };
}

/** How many settings the patch touches, for "N settings saved" and the unsaved counter. */
export function authPagesPatchSize(patch: AuthPagesPatch): number {
  let n = patch.variant ? 1 : 0;
  for (const page of PAGES) n += Object.keys(patch[page] ?? {}).length;
  n += patch.clearMedia?.length ?? 0;
  for (const page of SHOWCASE_PAGES) n += Object.keys(patch.extra?.[page] ?? {}).length;
  return n;
}

/**
 * What a visitor would see for this draft: an emptied field shows the shipped default, an accent
 * that is not a colour shows the shipped accent, media only when it is a usable https URL.
 */
export function resolvePreviewContent(
  page: AuthPageName,
  d: PageDraft,
  defaults: PageDefaults,
): AuthPageContent {
  const shipped = defaults[page];
  const accent = d.accent.trim();
  return {
    eyebrow: d.eyebrow.trim() || shipped.eyebrow,
    heading: d.heading.trim() || shipped.heading,
    headingAccent: d.headingAccent.trim() || shipped.headingAccent,
    subheading: d.subheading.trim() || shipped.subheading,
    accent: isHexColour(accent) ? accent.toLowerCase() : shipped.accent,
    ...(isHttpsUrl(d.mediaUrl) ? { mediaUrl: d.mediaUrl.trim(), mediaType: d.mediaType } : {}),
  };
}

/** The showcase copy the preview should render: only non-empty entries (the shell fills in its own defaults). */
export function resolvePreviewExtra(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values)
      .map(([k, v]) => [k, v.trim()])
      .filter(([, v]) => v !== ''),
  );
}

/** Maps an API field path to the page tab and control it belongs to. */
export function authPagesFieldForPath(
  path: string,
): { page: AuthPageName | null; control: string } | null {
  const content = /^(login|register|forgot)\.(\w+)$/.exec(path);
  if (content) return { page: content[1] as AuthPageName, control: `${content[1]}-${content[2]}` };
  const extra = /^extra\.(login|register|forgot)\.(\w+)$/.exec(path);
  if (extra) return { page: extra[1] as AuthPageName, control: `extra-${extra[1]}-${extra[2]}` };
  if (path === 'variant') return { page: null, control: 'variant' };
  if (path.startsWith('clearMedia')) return { page: null, control: 'variant' };
  return null;
}
