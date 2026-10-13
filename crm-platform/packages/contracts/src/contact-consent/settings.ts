import { z } from 'zod';
import {
  compileConsentKeywords,
  fillConsentReply,
  matchConsentKeyword,
  pickByLang,
} from './keywords';

const lang = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, 'language code');
const keyword = z.string().trim().min(1).max(40);
const upTo25 = (m: Record<string, unknown>) => Object.keys(m).length <= 25;
const keywordMap = z.record(lang, z.array(keyword).max(50)).refine(upTo25, 'at most 25 languages');
const textMap = (max: number) =>
  z.record(lang, z.string().trim().min(1).max(max)).refine(upTo25, 'at most 25 languages');

export const CONSENT_DEFAULT_OPT_OUT_KEYWORDS: Record<string, string[]> = {
  en: ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPT OUT'],
  ar: ['إيقاف', 'ايقاف', 'توقف', 'إلغاء الاشتراك', 'الغاء الاشتراك'],
};
export const CONSENT_DEFAULT_OPT_IN_KEYWORDS: Record<string, string[]> = {
  en: ['START', 'SUBSCRIBE', 'UNSTOP'],
  ar: ['اشتراك', 'ابدأ'],
};
export const CONSENT_DEFAULT_OPT_OUT_REPLY: Record<string, string> = {
  en: 'You have been unsubscribed from marketing messages and will not receive more. Reply START to subscribe again.',
  ar: 'تم إلغاء اشتراكك في الرسائل التسويقية ولن تصلك رسائل أخرى. أرسل اشتراك للاشتراك من جديد.',
};
export const CONSENT_DEFAULT_OPT_IN_REPLY: Record<string, string> = {
  en: 'You are subscribed again. Reply STOP at any time to unsubscribe.',
  ar: 'تم اشتراكك من جديد. أرسل إيقاف في أي وقت لإلغاء الاشتراك.',
};
export const CONSENT_DEFAULT_FOOTER: Record<string, string> = {
  en: 'Reply STOP to unsubscribe',
  ar: 'أرسل إيقاف لإلغاء الاشتراك',
};

export const consentSettingsSchema = z.object({
  /** Master switch: detect STOP / START in inbound messages. */
  detectionEnabled: z.boolean(),
  /** Only contacts with a recorded `granted` receive marketing sends. Withdrawn contacts are always skipped. */
  requireConsentForMarketing: z.boolean(),
  optOutKeywords: keywordMap,
  optInKeywords: keywordMap,
  autoReplyEnabled: z.boolean(),
  optOutReply: textMap(600),
  optInReply: textMap(600),
  /** The line the composers append to marketing texts. */
  footerText: textMap(160),
  /** Default state of the composer checkbox "Add the opt-out line". */
  footerDefaultOn: z.boolean(),
});
export type ConsentSettingsValues = z.infer<typeof consentSettingsSchema>;

export const CONSENT_SETTINGS_DEFAULTS: ConsentSettingsValues = {
  detectionEnabled: true,
  requireConsentForMarketing: false,
  optOutKeywords: CONSENT_DEFAULT_OPT_OUT_KEYWORDS,
  optInKeywords: CONSENT_DEFAULT_OPT_IN_KEYWORDS,
  autoReplyEnabled: true,
  optOutReply: CONSENT_DEFAULT_OPT_OUT_REPLY,
  optInReply: CONSENT_DEFAULT_OPT_IN_REPLY,
  footerText: CONSENT_DEFAULT_FOOTER,
  footerDefaultOn: true,
};

/** A save replaces the whole document (the screen edits all of it); `rowVersion` is absent on the first save. */
export const updateConsentSettingsSchema = consentSettingsSchema.extend({
  rowVersion: z.number().int().positive().optional(),
});
export type UpdateConsentSettingsInput = z.infer<typeof updateConsentSettingsSchema>;

export interface ConsentSettings extends ConsentSettingsValues {
  rowVersion: number | null;
  updatedAt: string | null;
}

export const testConsentMessageSchema = z.object({
  text: z.string().max(2000),
  /** Test against unsaved edits from the screen; absent = the saved settings. */
  optOutKeywords: keywordMap.optional(),
  optInKeywords: keywordMap.optional(),
});
export type TestConsentMessageInput = z.infer<typeof testConsentMessageSchema>;

export interface TestConsentMessageResult {
  match: 'opt_out' | 'opt_in' | 'none';
  keyword: string | null;
  lang: string | null;
  /** What the contact would be sent back, or null (no reply, detection off or auto reply off). */
  reply: string | null;
  /** Plain-language outcome for the screen. */
  outcome: 'opts_out' | 'opts_in' | 'no_match' | 'detection_off';
}

/** The rule applied to a text against a settings document: shared by the test box and the listener. */
export function evaluateConsentMessage(
  text: string,
  s: Pick<
    ConsentSettingsValues,
    | 'detectionEnabled'
    | 'autoReplyEnabled'
    | 'optOutKeywords'
    | 'optInKeywords'
    | 'optOutReply'
    | 'optInReply'
  >,
  vars: { name?: string | null } = {},
): TestConsentMessageResult {
  if (!s.detectionEnabled) {
    return { match: 'none', keyword: null, lang: null, reply: null, outcome: 'detection_off' };
  }
  const m = matchConsentKeyword(
    text,
    compileConsentKeywords({ optOut: s.optOutKeywords, optIn: s.optInKeywords }),
  );
  if (!m) return { match: 'none', keyword: null, lang: null, reply: null, outcome: 'no_match' };
  const tpl = pickByLang(m.action === 'opt_out' ? s.optOutReply : s.optInReply, m.lang);
  const reply = s.autoReplyEnabled && tpl !== '' ? fillConsentReply(tpl, vars) : null;
  return {
    match: m.action,
    keyword: m.keyword,
    lang: m.lang,
    reply,
    outcome: m.action === 'opt_out' ? 'opts_out' : 'opts_in',
  };
}

/** The audience counters a marketing send reports. */
export interface ConsentAudienceSkips {
  skippedOptedOut: number;
  skippedNoConsent: number;
}
