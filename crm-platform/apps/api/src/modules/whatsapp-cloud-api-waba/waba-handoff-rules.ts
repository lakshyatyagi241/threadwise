/**
 * Events that arrive on the WhatsApp callback but belong to another domain (TW-WABA-043): a WhatsApp Flow (form) submission and a
 * WhatsApp Pay status. Pure readers; the ingest service turns what they find into outbox events and keeps them out of the inbox.
 */

type Raw = Record<string, unknown>;

export interface FormSubmission {
  providerMessageId: string;
  /** The customer's number as digits. */
  from: string;
  name: string | null;
  /** The form's answers as Meta sent them (`response_json` is a JSON string); unparsable text is kept as `{ raw }`. */
  response: Record<string, unknown>;
  flowToken: string | null;
}

export interface PaymentUpdate {
  providerMessageId: string;
  /** The raw status entry; the owner confirms it against Meta's Payment Lookup instead of trusting this body. */
  status: Raw;
}

function parseResponse(json: unknown): Record<string, unknown> {
  if (json && typeof json === 'object') return json as Record<string, unknown>;
  if (typeof json !== 'string' || json === '') return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : { raw: json };
  } catch {
    return { raw: json };
  }
}

export function isFormSubmission(message: Raw): boolean {
  const interactive = message.interactive as { type?: string } | undefined;
  return message.type === 'interactive' && interactive?.type === 'nfm_reply';
}

export function formSubmissionOf(message: Raw, profileName: string | null): FormSubmission | null {
  if (!isFormSubmission(message)) return null;
  const reply = (message.interactive as { nfm_reply?: Raw }).nfm_reply ?? {};
  const response = parseResponse(reply.response_json);
  const token = response.flow_token;
  return {
    providerMessageId: String(message.id ?? ''),
    from: String(message.from ?? '').replace(/\D+/g, ''),
    name: profileName,
    response,
    flowToken: typeof token === 'string' ? token : null,
  };
}

/** Status entries of type `payment`, plus a bare `value.payment` block some Meta versions send. */
export function paymentUpdatesOf(value: Raw): PaymentUpdate[] {
  const out: PaymentUpdate[] = [];
  for (const s of (value.statuses as Raw[] | undefined) ?? []) {
    if (s.type === 'payment') out.push({ providerMessageId: String(s.id ?? ''), status: s });
  }
  if (value.payment && typeof value.payment === 'object') {
    out.push({
      providerMessageId: String((value.payment as Raw).id ?? ''),
      status: value.payment as Raw,
    });
  }
  return out;
}
