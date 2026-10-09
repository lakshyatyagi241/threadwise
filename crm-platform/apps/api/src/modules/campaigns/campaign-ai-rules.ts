import type { CampaignAiGenerateInput, CampaignAiGenerateResponse } from '@crm/contracts';

/** What the model is told. Strict JSON only, so the builder can paste each field without parsing prose. */
export const CAMPAIGN_AI_SYSTEM_PROMPT = `You write WhatsApp marketing-campaign messages. Output STRICT JSON only —
no prose, no markdown, no code fences. Schema:

{
  "campaign_name": "<short lowercase slug-ish label, max 60>",
  "message":       "<the body, max 1024, plain text with optional *bold* _italic_, use {{name}} for first-name token>",
  "footer":        "<short footer line, max 60, optional, no variables>",
  "button_text":   "<primary CTA label, max 25, optional>",
  "button_url":    "<https://... destination for the CTA, optional>",
  "quick_replies": ["<max 25 chars>", "<max 25 chars>", "<max 25 chars>"]
}

Rules:
1. Respect WhatsApp Business policy — no spam wording, no all-caps shouting, no emojis.
2. The message should hook in the first line, explain the offer, then suggest the next step.
3. Use {{name}} only when personalising; never invent other tokens.
4. quick_replies is 0-3 short labels the customer can tap to respond (e.g. "Yes please", "Not now").
5. button_text + button_url are the CTA that opens the destination when the customer taps. Skip both if no URL is provided.
6. Keep tone, language, and intent consistent with the brief.
7. Output ONLY the JSON object. No explanation. No code fences.`;

/** The brief as the model reads it: one line per field the person filled in. */
export function briefLines(i: CampaignAiGenerateInput): string[] {
  const lines = [`Business name: ${i.businessName}`];
  if (i.product) lines.push(`Product / service: ${i.product}`);
  if (i.goal) lines.push(`Campaign goal: ${i.goal}`);
  if (i.audience) lines.push(`Target audience: ${i.audience}`);
  if (i.offer) lines.push(`Offer / hook: ${i.offer}`);
  if (i.ctaLabel) lines.push(`Preferred CTA label: ${i.ctaLabel}`);
  if (i.ctaUrl) lines.push(`CTA destination URL: ${i.ctaUrl}`);
  if (i.tone) lines.push(`Tone: ${i.tone}`);
  if (i.customPrompt) lines.push('', 'Additional notes:', i.customPrompt);
  return lines;
}

const cut = (v: unknown, max: number): string => (typeof v === 'string' ? v : '').slice(0, max);

/**
 * The model's answer as the builder's fields, or null when it is not a JSON object. A code fence around the JSON is tolerated.
 * Every field is cut to the limit the builder enforces on submit, so what is pasted never fails validation later.
 */
export function parseCampaignCopy(raw: string): CampaignAiGenerateResponse['campaign'] | null {
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
  const replies = Array.isArray(o.quick_replies) ? o.quick_replies : [];
  return {
    campaignName: cut(o.campaign_name, 60),
    message: cut(o.message, 1024),
    footer: cut(o.footer, 60),
    buttonText: cut(o.button_text, 25),
    buttonUrl: cut(o.button_url, 1024),
    quickReplies: replies.slice(0, 3).map((r) => cut(r, 25)),
  };
}
