import type { ConsentSettings, UpdateConsentSettingsInput } from '@crm/contracts';

/** One language of the settings: its STOP / START words, the two confirmation replies and the opt-out line. */
export interface LangBlock {
  lang: string;
  optOut: string;
  optIn: string;
  optOutReply: string;
  optInReply: string;
  footer: string;
}

export interface SettingsForm {
  detectionEnabled: boolean;
  autoReplyEnabled: boolean;
  requireConsentForMarketing: boolean;
  footerDefaultOn: boolean;
  langs: LangBlock[];
}

/** Keywords are typed one per line (commas also split). Blank lines and repeats go. */
export function parseWords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,]/)) {
    const w = raw.trim();
    if (w === '' || seen.has(w.toLowerCase())) continue;
    seen.add(w.toLowerCase());
    out.push(w);
  }
  return out;
}

const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
export const isLangCode = (v: string): boolean => LANG.test(v);

/** English first, then the rest by code, so the screen order never jumps. */
const byLang = (a: string, b: string) => (a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b));

export function formFromSettings(s: ConsentSettings): SettingsForm {
  const codes = new Set([
    ...Object.keys(s.optOutKeywords),
    ...Object.keys(s.optInKeywords),
    ...Object.keys(s.optOutReply),
    ...Object.keys(s.optInReply),
    ...Object.keys(s.footerText),
  ]);
  return {
    detectionEnabled: s.detectionEnabled,
    autoReplyEnabled: s.autoReplyEnabled,
    requireConsentForMarketing: s.requireConsentForMarketing,
    footerDefaultOn: s.footerDefaultOn,
    langs: [...codes].sort(byLang).map((lang) => ({
      lang,
      optOut: (s.optOutKeywords[lang] ?? []).join('\n'),
      optIn: (s.optInKeywords[lang] ?? []).join('\n'),
      optOutReply: s.optOutReply[lang] ?? '',
      optInReply: s.optInReply[lang] ?? '',
      footer: s.footerText[lang] ?? '',
    })),
  };
}

/** The maps the API takes: a language with nothing typed for a field is left out of that map. */
export function mapsFromForm(form: SettingsForm) {
  const kw = (pick: (b: LangBlock) => string) =>
    Object.fromEntries(
      form.langs.map((b) => [b.lang, parseWords(pick(b))] as const).filter(([, w]) => w.length > 0),
    );
  const tx = (pick: (b: LangBlock) => string) =>
    Object.fromEntries(
      form.langs.map((b) => [b.lang, pick(b).trim()] as const).filter(([, v]) => v !== ''),
    );
  return {
    optOutKeywords: kw((b) => b.optOut),
    optInKeywords: kw((b) => b.optIn),
    optOutReply: tx((b) => b.optOutReply),
    optInReply: tx((b) => b.optInReply),
    footerText: tx((b) => b.footer),
  };
}

export function toSettingsInput(
  form: SettingsForm,
  rowVersion: number | null,
): UpdateConsentSettingsInput {
  return {
    detectionEnabled: form.detectionEnabled,
    autoReplyEnabled: form.autoReplyEnabled,
    requireConsentForMarketing: form.requireConsentForMarketing,
    footerDefaultOn: form.footerDefaultOn,
    ...mapsFromForm(form),
    rowVersion: rowVersion ?? undefined,
  };
}

export function settingsDirty(a: SettingsForm, b: SettingsForm): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** Problems the screen can see before it saves (the API checks again). */
export function formProblems(form: SettingsForm): Array<'noOptOutWord' | 'badLang' | 'dupLang'> {
  const out: Array<'noOptOutWord' | 'badLang' | 'dupLang'> = [];
  if (form.detectionEnabled && !form.langs.some((b) => parseWords(b.optOut).length > 0)) {
    out.push('noOptOutWord');
  }
  if (form.langs.some((b) => !isLangCode(b.lang))) out.push('badLang');
  if (new Set(form.langs.map((b) => b.lang)).size !== form.langs.length) out.push('dupLang');
  return out;
}

/** The marketing text as it will leave, with the opt-out line under it when asked for. */
export function withFooter(body: string, footer: string, on: boolean): string {
  const f = footer.trim();
  return on && f !== '' ? `${body}\n\n${f}` : body;
}
