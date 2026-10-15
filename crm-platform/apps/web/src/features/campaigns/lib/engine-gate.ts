import {
  CAMPAIGN_EMAIL_SUBJECT_MAX,
  type ComposeSender,
  type ComposeTemplate,
} from '@crm/contracts';
import type { BuilderForm } from './builder-model';

/**
 * What the sending number allows (TW-CAMP-005 to 007, Reference's engine gate on the create screen). The number's engine is the part of its
 * key before the colon: `waba` (Meta's official API, including a Meta test number), `twilio`, or `baileys` (the unofficial personal-number
 * engine).
 *
 * - **waba**: only approved templates can be sent to people outside the 24-hour window, so the Custom message and Flow builder types are
 *   not offered and the campaign is a template. Templates are those of that one number.
 * - **twilio**: a custom message is text and media only (buttons need a template); templates are Twilio's.
 * - **sms** (Twilio or MSG91 text messages, send-only): plain text, a custom message or a template, never a flow; no header, footer,
 *   attachment, buttons or split test (the SMS runner ignores them, so the builder does not offer them).
 * - **email** (a connected mailbox, send-only): a typed message with a subject (the Header field, at most 150), never a template, flow,
 *   A/B test or attachment; no footer, buttons, pacing or click tracking either (the server clears those, so the builder does not offer them).
 * - **baileys**: everything; templates are the unofficial ones.
 * - **none picked**: everything and every template, until a number is chosen.
 */

export type EngineKind = 'custom' | 'template' | 'flow';

/**
 * The engine a form sends on: the picked number's, and nothing (empty) while no number is picked, so every type and every template is
 * offered until a number is chosen, as in Reference's builder.
 */
export function engineOf(senderKey: string): string {
  return senderKey === '' ? '' : (senderKey.split(':')[0] ?? '');
}

/** The picked number, or none. */
export function senderOf(
  senderKey: string,
  senders: readonly ComposeSender[],
): ComposeSender | undefined {
  return senderKey === '' ? undefined : senders.find((s) => s.key === senderKey);
}

/** Twilio (WhatsApp), Meta's API and SMS cannot carry buttons on a custom message. */
export const isLimitedEngine = (engine: string): boolean =>
  engine === 'twilio' || engine === 'waba' || engine === 'sms';

/** An SMS number: text only, so the builder hides everything a text cannot carry. */
export const isSmsEngine = (engine: string): boolean => engine === 'sms';

/** A mailbox (the Email channel): a typed message with a subject, nothing a mail cannot carry. */
export const isEmailEngine = (engine: string): boolean => engine === 'email';

/** The campaign types the number can send. */
export const kindsFor = (engine: string): EngineKind[] =>
  engine === 'waba'
    ? ['template']
    : engine === 'sms'
      ? ['custom', 'template']
      : engine === 'email'
        ? ['custom']
        : ['custom', 'template', 'flow'];

/**
 * The templates the number can use: those of its engine, and for a Meta number only the ones of that number (a workspace with two Meta
 * numbers keeps each number's templates apart). A template with no number of its own stays visible.
 */
export function templatesFor(
  templates: readonly ComposeTemplate[],
  engine: string,
  sender: ComposeSender | undefined,
): ComposeTemplate[] {
  return templates.filter(
    (t) =>
      (engine === '' || t.engine === engine) &&
      (engine !== 'waba' || !sender || !t.senderLabel || t.senderLabel === sender.label),
  );
}

/** The Smart-delivery fields an email campaign does not have (its runner honours the auto-end date alone). */
const EMAIL_CLEARED_PACING = [
  'throttleMinSec',
  'throttleMaxSec',
  'batchSize',
  'batchPauseMin',
  'dailyLimit',
  'windowStart',
  'windowEnd',
] as const;

/**
 * What the form is forced to when the number cannot send what it holds: a Meta number turns a custom message or flow into a template,
 * a template the number cannot use is dropped, and buttons are dropped for Twilio and Meta (the server drops them too). Nothing is
 * returned when the form already fits.
 */
export function coerceForEngine(
  form: BuilderForm,
  engine: string,
  usable: readonly ComposeTemplate[],
): Partial<BuilderForm> {
  const out: Partial<BuilderForm> = {};
  if (engine === 'waba' && form.type !== 'template') out.type = 'template';
  if (engine === 'sms' && form.type === 'flow') out.type = 'custom';
  if (isEmailEngine(engine) && form.type !== 'custom' && form.type !== 'text') out.type = 'custom';
  const ids = new Set(usable.map((t) => t.id));
  if (form.templateId !== '' && !ids.has(form.templateId)) {
    out.templateId = '';
    out.templateOverrides = null;
  }
  if (form.templateIdB !== '' && !ids.has(form.templateIdB)) {
    out.templateIdB = '';
    out.templateOverridesB = null;
  }
  if (isLimitedEngine(engine) && form.buttons.length > 0) out.buttons = [];
  if (isSmsEngine(engine)) {
    // A text carries none of these; clearing them keeps what is saved equal to what is sent.
    if (form.customHeader !== '') out.customHeader = '';
    if (form.customFooter !== '') out.customFooter = '';
    if (form.mediaUrl !== '') out.mediaUrl = '';
    if (form.abTesting) out.abTesting = false;
    if (form.flowId !== '') out.flowId = '';
  }
  if (isEmailEngine(engine)) {
    // A mail is the typed message and its subject (the Header field) alone; what a mail cannot carry is cleared so what is saved equals
    // what is sent (the server clears the same fields and refuses a template, flow, A/B test or attachment).
    if (form.templateId !== '') out.templateId = '';
    if (form.templateIdB !== '') out.templateIdB = '';
    if (form.templateOverrides !== null) out.templateOverrides = null;
    if (form.templateOverridesB !== null) out.templateOverridesB = null;
    if (form.flowId !== '') out.flowId = '';
    if (form.flowIdB !== '') out.flowIdB = '';
    if (form.abTesting) out.abTesting = false;
    if (form.customMessageB !== '') out.customMessageB = '';
    if (form.mediaUrl !== '') out.mediaUrl = '';
    if (form.customFooter !== '') out.customFooter = '';
    if (form.buttons.length > 0) out.buttons = [];
    if (form.customHeader.length > CAMPAIGN_EMAIL_SUBJECT_MAX)
      out.customHeader = form.customHeader.slice(0, CAMPAIGN_EMAIL_SUBJECT_MAX);
    if (form.trackingEnabled) out.trackingEnabled = false;
    for (const k of EMAIL_CLEARED_PACING) if (form[k] !== '') out[k] = '';
  }
  return out;
}
