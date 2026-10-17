import {
  buildSend,
  type TemplateShape,
} from '../../../../../infra/providers/whatsapp/meta-send-payload';
import { buildRecipientVars } from '../../../../broadcasts';
import type { FlowTemplate } from '../../../../message-templates';
import type { MenuItem } from '../../types';

/** Meta rejects a template parameter that is empty; a value the run does not have yet goes out as this (TW-FLR-026 deviation). */
export const EMPTY_PARAMETER = '-';

interface Slot {
  num: number;
  key: string;
}

const slotsOf = (t: FlowTemplate, field: 'header' | 'body'): Slot[] => {
  const raw = t.variableMap[field];
  return Array.isArray(raw) ? raw.map((s) => ({ num: Number(s.num), key: String(s.key) })) : [];
};

/**
 * What fills a template's placeholders (TW-FLR-026 rule 3): each slot's key is the contact attribute (or flow variable) that supplies
 * it, resolved through the run's merge tags. Positional templates are keyed `1`, `2`; named ones by the parameter's name. A slot
 * with nothing to say is `-`, because Meta refuses an empty parameter.
 */
export function templateValues(
  t: FlowTemplate,
  field: 'header' | 'body',
  render: (tpl: string) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of slotsOf(t, field)) {
    const v = render(`{{${s.key}}}`).trim();
    out[t.parameterFormat === 'NAMED' ? s.key : String(s.num)] = v === '' ? EMPTY_PARAMETER : v;
  }
  return out;
}

/** The text with its `{{n}}` / `{{name}}` placeholders filled from `values`; an unknown placeholder stays as written. */
export function fillText(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (m, k: string) => values[k] ?? m);
}

/**
 * The message as the customer reads it: header, body and footer stacked (Reference's text and Baileys rendering), the footer in
 * italics. Also what a channel without templates is sent, and what the inbox thread shows.
 */
export function templateText(
  t: FlowTemplate,
  header: Record<string, string>,
  body: Record<string, string>,
): string {
  const lines: string[] = [];
  if (t.header) lines.push(fillText(t.header, header));
  lines.push(fillText(t.body, body));
  if (t.footer) lines.push(`_${t.footer}_`);
  return lines.join('\n\n');
}

/**
 * The Cloud API's own component list, needed only when the header carries placeholders (the envelope's `variables` fill the body
 * alone). Null when `variables` is enough.
 */
export function templateComponents(
  t: FlowTemplate,
  header: Record<string, string>,
  body: Record<string, string>,
): Array<Record<string, unknown>> | null {
  const headerKeys = Object.keys(header);
  if (headerKeys.length === 0) return null;
  const param = (k: string, v: string) => ({
    type: 'text',
    ...(t.parameterFormat === 'NAMED' ? { parameter_name: k } : {}),
    text: v,
  });
  const order = (o: Record<string, string>) =>
    Object.keys(o).sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  return [
    { type: 'header', parameters: order(header).map((k) => param(k, header[k]!)) },
    ...(Object.keys(body).length > 0
      ? [{ type: 'body', parameters: order(body).map((k) => param(k, body[k]!)) }]
      : []),
  ];
}

/**
 * The template's quick-reply buttons, in order. Only these send a tap back, so only these can branch the flow; URL, call and copy
 * buttons never reply (TW-FLR-026 rule 4).
 */
export function quickReplies(t: FlowTemplate, nodeId: string): MenuItem[] {
  return t.buttons
    .filter((b) => {
      const k = String(b.type ?? '').toLowerCase();
      return !(
        k.includes('url') ||
        k.includes('cta') ||
        k.includes('visit') ||
        k.includes('call') ||
        k.includes('phone') ||
        k.includes('copy')
      );
    })
    .slice(0, 10)
    .map((b, i) => ({ id: `tpl_${nodeId}_p${i}`, text: String(b.text ?? `Button ${i + 1}`) }));
}

/**
 * The Cloud API component list of a template that needs more than a body and a text header: a picture, video, document or location
 * header, or a button that takes a value (a link with a variable, a copy code). Without them Meta refuses the send (#132012,
 * #132000) and the node only logs it, so the flow carried on as if the template had gone. Built by the same payload builder
 * broadcasts use, from the same variable map. Null when the template is plain and `variables` and `templateComponents` are enough.
 */
export function richComponents(
  t: FlowTemplate,
  render: (tpl: string) => string,
): Array<Record<string, unknown>> | null {
  const shape: TemplateShape & { headerLocation: unknown } = {
    templateName: t.name,
    language: t.language,
    templateType: t.templateType ?? 'text',
    templateBody: t.body,
    header: t.header,
    attachmentType: t.attachmentType ?? null,
    attachmentFile: t.headerMediaUrl ?? null,
    parameterFormat: t.parameterFormat,
    variableMap: t.variableMap,
    buttons: t.buttons,
    carouselData: null,
    headerLocation: t.headerLocation ?? null,
  };
  const att = (t.attachmentType ?? '').toLowerCase();
  const richHeader = att !== '' && att !== 'none' && att !== 'text';
  const vars = buildRecipientVars(shape, {
    pull: (key) => render(`{{${key}}}`).trim(),
    mediaUrl: (path) => (/^https?:\/\//i.test(path) ? path : null),
  });
  if (!richHeader && (vars.buttons?.length ?? 0) === 0) return null;
  const built = buildSend(shape, vars).components as Array<Record<string, unknown>>;
  return built.length > 0 ? built : null;
}
