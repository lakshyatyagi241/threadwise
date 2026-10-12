/**
 * SMS segment and encoding calculator (TW-SMS-009). Pure, so the API and the web composer share one implementation.
 *
 * A text is GSM-7 only when every character is in the GSM basic or extension table; one character outside both makes the
 * whole message UCS-2. GSM-7 extension characters cost two units. UCS-2 counts UTF-16 code units (what the carrier counts),
 * so an emoji is two units. Reference counted code points and under-counted emoji; this is a deliberate fix.
 */

export const SMS_GSM_SINGLE = 160;
export const SMS_GSM_MULTI = 153;
export const SMS_UCS2_SINGLE = 70;
export const SMS_UCS2_MULTI = 67;

const GSM_BASIC = new Set(
  Array.from(
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
  ),
);
const GSM_EXTENSION = new Set(Array.from('^{}\\[~]|€'));

export type SmsEncoding = 'GSM-7' | 'UCS-2';

export interface SmsMeasure {
  segments: number;
  encoding: SmsEncoding;
  units: number;
  perSegment: number;
  remaining: number;
}

export function measureSms(text: string): SmsMeasure {
  let gsmUnits = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM_BASIC.has(ch)) gsmUnits += 1;
    else if (GSM_EXTENSION.has(ch)) gsmUnits += 2;
    else {
      gsm = false;
      break;
    }
  }
  const encoding: SmsEncoding = gsm ? 'GSM-7' : 'UCS-2';
  const units = gsm ? gsmUnits : text.length;
  const single = gsm ? SMS_GSM_SINGLE : SMS_UCS2_SINGLE;
  const multi = gsm ? SMS_GSM_MULTI : SMS_UCS2_MULTI;
  const segments = units <= single ? 1 : Math.ceil(units / multi);
  const perSegment = segments === 1 ? single : multi;
  return {
    segments,
    encoding,
    units,
    perSegment,
    remaining: Math.max(0, segments * perSegment - units),
  };
}

/** The operator warning shown under a composer; empty for a one-segment message. */
export function smsWarning(m: SmsMeasure): string {
  if (m.segments <= 1) return '';
  if (m.encoding === 'UCS-2') {
    return `This message contains characters outside the GSM alphabet (emoji or non-Latin script), so it is limited to ${SMS_UCS2_MULTI} characters per SMS and will be billed as ${m.segments} messages.`;
  }
  return `This message is ${m.units} characters and will be billed as ${m.segments} messages.`;
}
