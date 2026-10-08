import type { ComposeSender, ComposeTemplate } from '@crm/contracts';
import type { BuilderForm } from './builder-model';

/**
 * What the sending number allows (TW-CAMP-005 to 007, Reference's engine gate on the create screen). The number's engine is the part of its
 * key before the colon: `waba` (Meta's official API, including a Meta test number), `twilio`, or `baileys` (the unofficial personal-number
 * engine).
 *
 * - **waba**: only approved templates can be sent to people outside the 24-hour window, so the Custom message and Flow builder types are
 *   not offered and the campaign is a template. Templates are those of that one number.
 * - **twilio**: a custom message is text and media only (buttons need a template); templates are Twilio's.
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

/** Twilio and Meta's API cannot carry buttons on a custom message. */
export const isLimitedEngine = (engine: string): boolean =>
  engine === 'twilio' || engine === 'waba';

/** The campaign types the number can send. */
export const kindsFor = (engine: string): EngineKind[] =>
  engine === 'waba' ? ['template'] : ['custom', 'template', 'flow'];

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
  return out;
}
