import { CAMPAIGN_EMAIL_SUBJECT_MAX } from '@crm/contracts';

/**
 * The pure rules of an email campaign (Reference's `?channel=email` builder and `EmailCampaignRunner`). A campaign is an email campaign
 * when its sender is a mailbox (`provider` `email`, the sender key `email:<mailbox uuid>`). It reuses the campaign builder, audience,
 * schedule, pause and resume; only what a mail cannot carry is different. Nothing here reads a database or a clock.
 */

export const EMAIL_PROVIDER = 'email';

export const isEmailProvider = (provider: string | null | undefined): boolean =>
  provider === EMAIL_PROVIDER;

/** SMS (TW-SMS-027) and email are never charged to the WhatsApp wallet: they have their own plan caps. */
export const isWalletFree = (provider: string | null | undefined): boolean =>
  provider === 'sms' || provider === EMAIL_PROVIDER;

/** Reference's words for a recipient the run cannot mail, stamped on the recipient row. */
export const NO_EMAIL_ADDRESS = 'No email address on this contact';
export const DUPLICATE_EMAIL = 'Duplicate email address — already sent on this run';
export const INVALID_EMAIL = 'Invalid email address or empty message';
/** What a mail with no subject line says when the campaign has no name either (Reference). */
export const EMPTY_SUBJECT_FALLBACK = 'Message';
/** The longest subject that goes out after the contact's values are merged in (Reference cut at 255). */
export const SUBJECT_SEND_MAX = 255;

export interface EmailFormProblem {
  path: string;
  message: string;
}

/** The part of a campaign form the email rules look at. */
export interface EmailFormShape {
  type: string;
  abTesting?: boolean | null | undefined;
  customHeader?: string | null | undefined;
  mediaUrl?: string | null | undefined;
  templateId?: string | null | undefined;
  templateIdA?: string | null | undefined;
  templateIdB?: string | null | undefined;
  flowId?: string | null | undefined;
  flowIdB?: string | null | undefined;
}

/**
 * What an email campaign cannot be. Reference's builder hides the template picker, the flow choice, the A/B test and the attachment on
 * this channel (its runner reads the typed message alone, so offering them would silently send something else); the server refuses them
 * too, so a request made by hand cannot get a different answer than the screen. The subject is the Header field, at most 150.
 */
export function emailCampaignProblems(form: EmailFormShape): EmailFormProblem[] {
  const out: EmailFormProblem[] = [];
  if (form.type !== 'custom' && form.type !== 'text') {
    out.push({
      path: 'type',
      message: 'An email campaign sends a typed message. Pick Custom message.',
    });
  }
  if (form.templateId || form.templateIdA || form.templateIdB) {
    out.push({
      path: 'templateId',
      message: 'An email campaign sends a typed message, not a template.',
    });
  }
  if (form.flowId || form.flowIdB) {
    out.push({ path: 'flowId', message: 'An email campaign cannot start a flow.' });
  }
  if (form.abTesting) {
    out.push({ path: 'abTesting', message: 'An email campaign has no A/B test.' });
  }
  if (form.mediaUrl) {
    out.push({ path: 'mediaUrl', message: 'An email campaign carries no attachment.' });
  }
  if ((form.customHeader ?? '').length > CAMPAIGN_EMAIL_SUBJECT_MAX) {
    out.push({
      path: 'customHeader',
      message: `The subject can be at most ${CAMPAIGN_EMAIL_SUBJECT_MAX} characters.`,
    });
  }
  return out;
}

/**
 * What is stored on an email campaign whatever the form said: the parts a mail does not use are cleared so the saved campaign equals
 * what is sent. No footer or buttons (the body is the whole message), no per-message pacing or send window or daily cap (Reference
 * hides them: its mail runner honours the auto-end date alone), and no click tracking (its runner has none).
 */
export const emailCleared = () => ({
  customFooter: null as string | null,
  customButtons: [] as unknown[],
  customQuickReplies: [] as unknown[],
  throttleMinSec: null as number | null,
  throttleMaxSec: null as number | null,
  batchSize: null as number | null,
  batchPauseMin: null as number | null,
  dailyLimit: null as number | null,
  windowStart: null as string | null,
  windowEnd: null as string | null,
  trackingEnabled: false,
});

/** The address as it is compared and sent: trimmed and lower-cased. */
export const normalizeAddress = (raw: string | null | undefined): string =>
  (raw ?? '').trim().toLowerCase();

const ADDRESS = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/u;

/** A plausible single address (no name part, no list): the provider is the final judge, this keeps junk and header tricks out. */
export const isMailableAddress = (address: string): boolean =>
  address.length <= 320 && ADDRESS.test(address);

/** The text a mail's subject is made from before the contact's values are merged in: the Header field, else the campaign name. */
export const subjectSource = (header: string | null | undefined, campaignName: string): string =>
  (header ?? '').trim() !== '' ? (header as string) : campaignName.trim();

/**
 * The subject of one mail once the contact's values are merged in: line breaks turned into spaces (a CR or LF inside a header would open
 * a second one, `Bcc: ...`; it arrives through the contact's own values, so this runs after the merge), cut at 255, and "Message" when
 * nothing is left.
 */
export function cleanSubject(rendered: string | null | undefined): string {
  const subject = (rendered ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, SUBJECT_SEND_MAX)
    .trim();
  return subject === '' ? EMPTY_SUBJECT_FALLBACK : subject;
}
