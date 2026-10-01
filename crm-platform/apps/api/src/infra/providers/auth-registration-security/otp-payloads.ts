/**
 * Pure builders for what each OTP transport puts on the wire. No I/O, so the
 * exact bodies are unit-tested without a server.
 */

/** The template language the OTP template is created and sent in. */
export const OTP_TEMPLATE_LANGUAGE = 'en_US';
/** Meta template names: lowercase letters, digits and underscores. */
export const WABA_OTP_TEMPLATE_NAME = 'crm_signup_otp';
export const LOCAL_OTP_TEMPLATE_NAME = 'crm_signup_otp_local';

const minutesWord = (n: number) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;

/** Digits of an E.164 number: what WhatsApp providers want as a recipient. */
export const digitsOf = (e164: string): string => e164.replace(/\D/g, '');

/** The text of a local (non-Meta) OTP template, `{{1}}` standing for the code. */
export function localTemplateBody(ttlMinutes: number): string {
  return `{{1}} is your verification code. It expires in ${minutesWord(ttlMinutes)}.`;
}

/**
 * The message a non-template sender delivers: the template body with the code
 * substituted, else a plain sentence with the code, the expiry and a warning.
 */
export function renderOtpText(opts: {
  templateBody: string | null;
  code: string;
  ttlMinutes: number;
  appName: string;
}): string {
  const body = opts.templateBody?.trim();
  if (body) return body.replace(/\{\{\s*(?:1|code|otp)\s*\}\}/gi, opts.code);
  return `_${opts.code}_ is your ${opts.appName} verification code. It expires in ${minutesWord(opts.ttlMinutes)}. Do not share it with anyone.`;
}

// --- Meta Cloud API (waba) ---------------------------------------------------------------------------------------

const metaOtpComponents = (ttlMinutes: number) => [
  // Meta fixes the body of an authentication template ("<code> is your
  // verification code."); the recommendation line is the only switch.
  { type: 'BODY', add_security_recommendation: true },
  { type: 'FOOTER', code_expiration_minutes: ttlMinutes },
  { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
];

/** Body of `POST {graph}/{wabaId}/message_templates`. */
export function buildMetaTemplateCreateBody(opts: {
  name: string;
  language: string;
  ttlMinutes: number;
}) {
  return {
    name: opts.name,
    language: opts.language,
    category: 'AUTHENTICATION',
    components: metaOtpComponents(opts.ttlMinutes),
  };
}

/** Body of `POST {graph}/{templateId}`: edit a rejected or out-of-date template. */
export function buildMetaTemplateUpdateBody(opts: { ttlMinutes: number }) {
  return { components: metaOtpComponents(opts.ttlMinutes) };
}

/** Body of `POST {graph}/{phoneNumberId}/messages`: the approved template with the code as its variable. */
export function buildWabaSendBody(opts: {
  to: string;
  templateName: string;
  language: string;
  code: string;
}) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: digitsOf(opts.to),
    type: 'template',
    template: {
      name: opts.templateName,
      language: { code: opts.language },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: opts.code }] },
        // The copy-code button carries the code as well.
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: opts.code }],
        },
      ],
    },
  };
}

export interface MetaTemplateStatus {
  status: 'pending' | 'approved' | 'rejected';
  rejectedReason: string | null;
}

/** Maps Meta's template status words onto the three states the OTP gate cares about. */
export function mapMetaTemplateStatus(
  raw: string | null | undefined,
  rejectedReason?: string | null,
): MetaTemplateStatus {
  const status = (raw ?? '').toUpperCase();
  if (status === 'APPROVED') return { status: 'approved', rejectedReason: null };
  if (status === 'REJECTED') {
    const reason = rejectedReason && rejectedReason !== 'NONE' ? rejectedReason : null;
    return { status: 'rejected', rejectedReason: reason ?? 'Meta rejected the template.' };
  }
  // Paused, disabled, flagged, over the limit: it cannot send, and a person has to act.
  if (['PAUSED', 'DISABLED', 'FLAGGED', 'LIMIT_EXCEEDED', 'DELETED'].includes(status)) {
    return { status: 'rejected', rejectedReason: `Meta marked the template ${status}.` };
  }
  return { status: 'pending', rejectedReason: null };
}

// --- Twilio ----------------------------------------------------------------------------------------------------------------

/** "+1 415-523-8886" -> "+14155238886". */
export function e164Of(number: string): string {
  return `+${digitsOf(number)}`;
}

/** Form body of `POST {api}/2010-04-01/Accounts/{sid}/Messages.json`. */
export function buildTwilioForm(opts: { from: string; to: string; body: string }): URLSearchParams {
  return new URLSearchParams({
    From: `whatsapp:${e164Of(opts.from)}`,
    To: `whatsapp:+${digitsOf(opts.to)}`,
    Body: opts.body,
  });
}

// --- Node bridge (unofficial session) ----------------------------------------------------------------------------

/** Body of `POST {bridge}/api/send-message/{senderNumber}`. */
export function buildBridgeBody(opts: { to: string; message: string }) {
  return { targetPhoneNumber: digitsOf(opts.to), message: opts.message };
}
