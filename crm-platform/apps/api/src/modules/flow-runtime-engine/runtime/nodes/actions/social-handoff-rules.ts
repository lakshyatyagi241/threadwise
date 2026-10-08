type Bag = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const digits = (v: unknown): string => str(v).replace(/\D+/g, '');

/** The most variables a hand-off carries across to the WhatsApp flow: the run's variable bag is not unbounded. */
const MAX_VARS = 50;

export type HandoffPlan =
  /** Deep-link mode: the customer taps a `wa.me` link and writes to the business's WhatsApp themselves. */
  | { mode: 'link'; text: string }
  /** Direct mode: say `intro` (when there is one), then start the WhatsApp flow for `number`. */
  | {
      mode: 'direct';
      intro: string;
      number: string;
      flowRef: unknown;
      variables: Record<string, string>;
    }
  | { mode: 'skip'; why: string };

/**
 * What a "Hand off to WhatsApp" node (`ig_to_whatsapp`, `fb_to_whatsapp`, TW-FLR-010 rule 6) does. Pure.
 *
 * Reference's two modes: `deeplink` sends the intro and a `wa.me` link (the number is the node's own, the pre-filled text is
 * URL-encoded) and Meta's rules are kept because the customer starts the WhatsApp chat; `direct` starts a chosen WhatsApp flow
 * for a number the flow captured earlier (`numberVar`, default `wa_number`) and relies on that number having opted in.
 * A node with nothing to act on (no number, no flow) is skipped, never an error: the Instagram or Messenger chat carries on.
 */
export function handoffPlan(
  d: Bag,
  render: (t: unknown) => string,
  vars: Record<string, unknown>,
): HandoffPlan {
  const intro = render(d.introText).trim();
  if (str(d.mode) !== 'direct') {
    const number = digits(render(d.waNumber));
    if (number === '') return { mode: 'skip', why: 'no WhatsApp number on the node' };
    const prefill = render(d.prefillText);
    const link = `https://wa.me/${number}${prefill !== '' ? `?text=${encodeURIComponent(prefill)}` : ''}`;
    return { mode: 'link', text: intro !== '' ? `${intro}\n${link}` : link };
  }
  const numberVar = str(d.numberVar).trim() || 'wa_number';
  const number = digits(vars[numberVar]);
  if (number === '') return { mode: 'skip', why: `no number in {{${numberVar}}}` };
  const flowRef = d.waFlowId ?? d.flowId;
  if (str(flowRef).trim() === '' || str(flowRef).trim() === '0') {
    return { mode: 'skip', why: 'no WhatsApp flow chosen' };
  }
  const variables: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (Object.keys(variables).length >= MAX_VARS) break;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      variables[k] = String(v);
    }
  }
  return { mode: 'direct', intro, number, flowRef, variables };
}
