/**
 * The privacy mask of the Help assistant (docs/specs/help-agent-assistant.md section 6.4). It runs on the text the page-agent library
 * built from the DOM, just before that text leaves the browser for the AI provider (`transformPageContent`). Pattern based on purpose:
 * it takes out what is reliably recognisable (e-mail addresses, phone numbers, long numbers, secrets, the value of a field that says it
 * holds a phone, an e-mail, an address or a person's name). A person's name in a table cell cannot be told from a product name, so it is
 * not masked; the first-use notice says so. Whole regions that should never be read carry `data-agent-ignore` / `data-agent-pii`
 * (see `marks.ts`).
 */

export const MASK = '[masked]';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const KEYED_TOKEN = /\b(?:sk|pk|rk|whsec|ghp|gho|xox[abpr]|AKIA|AIza|EAA)[-_A-Za-z0-9]{16,}\b/g;
/** 32+ characters of letters and digits with at least one digit and one letter: a key, a hash, a bearer token. */
const LONG_TOKEN = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g;
const PHONE = /(?<![\w.])\+?\(?\d[\d\s().-]{5,}\d(?![\w])/g;
const LONG_DIGITS = /\+?\b\d{12,}\b/g;

const DATE_LIKE = /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$|^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/;

function maskPhones(text: string): string {
  return text.replace(PHONE, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 7 || DATE_LIKE.test(m.trim())) return m;
    const formatted = /^\+/.test(m) || /[\s().-]/.test(m.trim());
    return formatted || digits.length >= 10 ? MASK : m;
  });
}

/** The names a field gives itself when it holds personal data. */
const PII_FIELD =
  /(phone|mobile|whatsapp|\btel\b|msisdn|e-?mail|address|street|city|zip|postal|postcode|\bdob\b|birth|(first|last|full|middle|contact|customer|display|user|sur)[ _-]?name|surname|هاتف|جوال|بريد|عنوان|الاسم)/i;

/** One element line of the library's text: `[3]<input type=tel name=phone value=+91 98765 placeholder=Phone />`. */
const FIELD_LINE = /^(\s*\*?\[\d+\]<(?:input|textarea|select)\b)(.*)$/;
/** The value attribute runs until the next known attribute or the end of the tag (values are not quoted, and may hold spaces). */
const VALUE_ATTR =
  /(\bvalue=)(.*?)(?= (?:type|name|role|placeholder|id|for|title|alt|checked|target|aria-[\w-]+|data-[\w-]+|contenteditable)=|\s*\/?>|\s*\/>|$)/;

function maskFieldLine(line: string): string {
  const m = FIELD_LINE.exec(line);
  if (!m) return line;
  const rest = m[2] ?? '';
  const isPersonal =
    /\btype=(tel|email)\b/.test(rest) ||
    PII_FIELD.test(
      rest.replace(/\bvalue=.*?(?= (?:type|name|placeholder|id|title|aria-[\w-]+)=|$)/, ''),
    );
  if (!isPersonal) return line;
  return `${m[1]}${rest.replace(VALUE_ATTR, (_all, key: string, value: string) => (value.trim() === '' ? `${key}${value}` : `${key}${MASK}`))}`;
}

/** Applied to the whole simplified page, once per model call. Never throws; on an unexpected failure it returns a fully masked line. */
export function maskPageContent(content: string): string {
  try {
    const lines = content.split('\n').map(maskFieldLine);
    return maskPhones(
      lines
        .join('\n')
        .replace(EMAIL, MASK)
        .replace(JWT, MASK)
        .replace(KEYED_TOKEN, MASK)
        .replace(LONG_TOKEN, MASK)
        .replace(LONG_DIGITS, MASK),
    );
  } catch {
    return MASK;
  }
}
