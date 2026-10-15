import type { TplAiDraft, TplAiGenerateInput } from '@crm/contracts';

/**
 * What the model is told for "Build with AI" on the template form (TW-TPL-016). Strict JSON only, so the form can fill each field
 * without parsing prose. Reference also offered a carousel draft and a copy-code button; both are left out here (a carousel needs
 * cards with their own media, and a copy-code button needs an example code Meta reviews, which a model cannot know).
 */
export const TEMPLATE_AI_SYSTEM_PROMPT = `You write WhatsApp Business message templates. Output STRICT JSON only —
no prose, no markdown, no code fences. Schema:

{
  "template_name": "<lowercase a-z 0-9 underscore, max 60>",
  "header": "<plain text, max 60, optional, no variables>",
  "body":   "<the main message, max 1024, use *bold* _italic_ markers, use {{1}} {{2}} for placeholders>",
  "footer": "<short legal/closing line, max 60, optional, no variables>",
  "buttons": [
    { "type": "visit_website|call_phone|quick_reply", "text": "<max 25>", "value": "<https url | phone number with country code | empty for quick_reply>" }
  ]
}

Rules:
1. Match Meta's WhatsApp Business template policy: clear, no spammy wording, no emojis, no all-caps shouting.
2. Use {{1}}, {{2}} for personalisation tokens — the customer's first name is {{1}}. Number them in order, never skip one.
3. Buttons are optional. If you include them, keep to 1-3, and never mix a quick reply with a link button.
4. Keep tone, language, and intent consistent with the brief.
5. Output ONLY the JSON object. No explanation. No code fences.`;

/** The brief as the model reads it: one line per field the person filled in. */
export function templateBriefLines(i: TplAiGenerateInput): string[] {
  const lines = [
    `Business name: ${i.businessName}`,
    `Template category (Meta review path): ${i.metaCategory.toLowerCase()}`,
    `Language: ${i.language}`,
  ];
  if (i.industry) lines.push(`Industry: ${i.industry}`);
  if (i.occasion) lines.push(`Occasion: ${i.occasion}`);
  if (i.purpose) lines.push(`Message purpose: ${i.purpose}`);
  if (i.action) lines.push(`Primary call to action: ${i.action}`);
  if (i.tone) lines.push(`Tone: ${i.tone}`);
  if (i.customPrompt) lines.push('', 'Additional operator notes:', i.customPrompt);
  return lines;
}

const cut = (v: unknown, max: number): string =>
  (typeof v === 'string' ? v : '').trim().slice(0, max);
const noVariables = (s: string): string =>
  s
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A name Meta takes: lower-case letters, digits and underscores, up to 60 characters. */
export function templateSlug(raw: unknown): string {
  const slug = cut(raw, 120)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
    .replace(/_+$/g, '');
  return slug === '' ? 'ai_template' : slug;
}

/**
 * The model's answer as the form's fields, or null when it is not a JSON object (a code fence around it is tolerated). Every field is
 * cut to the limit the form and Meta enforce so what is pasted never fails lint for its size: the name is made a valid slug, the
 * header and footer lose any variable (Meta allows none there), at most three buttons are kept, a link button needs an http(s)
 * address and a call button a phone number, a quick reply is never kept next to a link button (Meta's order rule).
 */
export function parseTemplateDraft(raw: string): TplAiDraft | null {
  let clean = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(clean);
  if (fenced) clean = (fenced[1] ?? '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;

  const buttons: TplAiDraft['buttons'] = [];
  const list = Array.isArray(o.buttons) ? o.buttons : [];
  for (const b of list.slice(0, 3)) {
    if (typeof b !== 'object' || b === null) continue;
    const r = b as Record<string, unknown>;
    const text = cut(r.text, 25);
    const value = cut(r.value, 2000);
    if (text === '') continue;
    const type = cut(r.type, 32).toLowerCase();
    if (type === 'visit_website') {
      if (/^https?:\/\/\S+$/i.test(value)) buttons.push({ type: 'URL', text, url: value });
    } else if (type === 'call_phone') {
      const phone = value.replace(/[^\d+]/g, '');
      if (/^\+?\d{6,19}$/.test(phone))
        buttons.push({ type: 'PHONE_NUMBER', text, phoneNumber: phone });
    } else if (type === 'quick_reply') {
      buttons.push({ type: 'QUICK_REPLY', text });
    }
  }
  // Meta lists quick replies first or last as a group, never between call-to-action buttons: keep the group of the first button.
  const hasLink = buttons.some((b) => b.type !== 'QUICK_REPLY');
  const kept = hasLink ? buttons.filter((b) => b.type !== 'QUICK_REPLY') : buttons;

  return {
    name: templateSlug(o.template_name),
    header: noVariables(cut(o.header, 200)).slice(0, 60) || null,
    body: cut(o.body, 1024),
    footer: noVariables(cut(o.footer, 200)).slice(0, 60) || null,
    buttons: kept,
  };
}
