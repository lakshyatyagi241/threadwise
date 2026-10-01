// Edge-case value catalogue per field type. A case is {id, value, why, depth}. `value` may be a function of the
// field definition (so `max` / `max+1` follow the field's declared limit). The oracle is WaDesk, not this file:
// nothing here says whether a value SHOULD be accepted, the twin run only compares the two apps' reactions.
//
// depth: quick (smoke) < standard < full. A run at depth D includes every case with depth <= D.

const pad = (n, ch = 'a') => ch.repeat(Math.max(0, n));
const ORDER = { quick: 0, standard: 1, full: 2 };

const TEXT = [
  { id: 'empty', value: '', why: 'required rule / default', depth: 'quick' },
  { id: 'spaces', value: '    ', why: 'whitespace-only counts as empty?', depth: 'quick' },
  { id: 'typical', value: 'Pat Example', why: 'baseline', depth: 'quick' },
  {
    id: 'max',
    value: (f) => pad(f.max ?? 255),
    why: 'exactly at the length limit',
    depth: 'quick',
    needs: (f) => f.max != null,
  },
  {
    id: 'max+1',
    value: (f) => pad((f.max ?? 255) + 1),
    why: 'one over the length limit',
    depth: 'quick',
    needs: (f) => f.max != null,
  },
  {
    id: 'long-300',
    value: () => pad(300),
    why: 'no declared limit: is there a silent one?',
    depth: 'standard',
    needs: (f) => f.max == null,
  },
  { id: 'unicode', value: 'Zoë Müller 李雷 Ñandú', why: 'accents, CJK', depth: 'quick' },
  { id: 'html', value: '<b>bold</b> & <i>it</i>', why: 'markup must be inert', depth: 'quick' },
  { id: 'single-char', value: 'A', why: 'minimum length', depth: 'standard' },
  {
    id: 'padded',
    value: '  padded value  ',
    why: 'is it trimmed before save/validation?',
    depth: 'standard',
  },
  {
    id: 'emoji',
    value: 'Party 🎉🚀 time',
    why: '4-byte characters (utf8mb4 vs utf8)',
    depth: 'standard',
  },
  { id: 'rtl', value: 'مرحبا بالعالم שלום', why: 'right-to-left text', depth: 'standard' },
  {
    id: 'sql',
    value: "Robert'); DROP TABLE contacts;--",
    why: 'quote handling',
    depth: 'standard',
  },
  {
    id: 'script',
    value: '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>',
    why: 'stored XSS must not execute where it is shown',
    depth: 'standard',
    xss: true,
  },
  {
    id: 'newline',
    value: 'line one\nline two',
    why: 'multi-line in a single-line field',
    depth: 'standard',
  },
  { id: 'very-long', value: () => pad(5000), why: 'payload size / truncation', depth: 'full' },
  { id: 'tab', value: 'a\tb', why: 'control character', depth: 'full' },
  { id: 'zero-width', value: 'ab\u200bcd\u200d', why: 'invisible characters', depth: 'full' },
  {
    id: 'combining',
    value: 'e\u0301e\u0301',
    why: 'normalisation (NFC vs NFD) and length counting',
    depth: 'full',
  },
  { id: 'quotes', value: `He said "hi" and 'bye'`, why: 'quote escaping', depth: 'full' },
  { id: 'backslash', value: 'C:\\temp\\new \\n', why: 'escape handling', depth: 'full' },
  { id: 'percent', value: '100% {{x}} ${y} %s', why: 'template / format tokens', depth: 'full' },
  {
    id: 'url-ish',
    value: 'https://example.com/?a=1&b=2#x',
    why: 'auto-linking / encoding',
    depth: 'full',
  },
  { id: 'digits', value: '1234567890', why: 'numeric-looking text', depth: 'full' },
  {
    id: 'null-byte',
    value: 'a\u0000b',
    why: 'NUL must be rejected or stripped, never crash',
    depth: 'full',
  },
  { id: 'case-mix', value: 'MiXeD cAsE', why: 'case preserved', depth: 'full' },
];

const EMAIL = [
  { id: 'empty', value: '', why: 'optional vs required', depth: 'quick' },
  { id: 'valid', value: 'pat.example@example.com', why: 'baseline', depth: 'quick' },
  { id: 'no-at', value: 'pat.example.com', why: 'format', depth: 'quick' },
  { id: 'plus-tag', value: 'pat+tag@example.com', why: 'plus addressing allowed', depth: 'quick' },
  { id: 'spaces', value: 'pat example@example.com', why: 'inner space', depth: 'standard' },
  { id: 'no-domain', value: 'pat@', why: 'format', depth: 'standard' },
  { id: 'double-dot', value: 'pat..example@example.com', why: 'format', depth: 'standard' },
  {
    id: 'uppercase',
    value: 'PAT.EXAMPLE@EXAMPLE.COM',
    why: 'case folding on save and on uniqueness',
    depth: 'standard',
  },
  { id: 'padded', value: '  pat@example.com  ', why: 'trim', depth: 'standard' },
  { id: 'no-tld', value: 'pat@localhost', why: 'dotless domain', depth: 'full' },
  {
    id: 'unicode-local',
    value: 'pät@example.com',
    why: 'internationalised local part',
    depth: 'full',
  },
  { id: 'idn-domain', value: 'pat@exämple.com', why: 'internationalised domain', depth: 'full' },
  {
    id: 'max-254',
    value: () =>
      `${pad(64, 'a')}@${pad(63, 'b')}.${pad(63, 'c')}.${pad(55, 'd')}.com`.slice(0, 254),
    why: 'length ceiling',
    depth: 'full',
  },
  {
    id: 'over-254',
    value: () => `${pad(64, 'a')}@${pad(63, 'b')}.${pad(63, 'c')}.${pad(63, 'd')}.com`,
    why: 'over the ceiling',
    depth: 'full',
  },
  { id: 'two-at', value: 'a@b@example.com', why: 'format', depth: 'full' },
  {
    id: 'list',
    value: 'a@example.com, b@example.com',
    why: 'list in a single field',
    depth: 'full',
  },
  { id: 'angle', value: 'Pat <pat@example.com>', why: 'display-name form', depth: 'full' },
  { id: 'trailing-dot', value: 'pat@example.com.', why: 'format', depth: 'full' },
];

const PHONE = [
  { id: 'empty', value: '', why: 'optional vs required', depth: 'quick' },
  { id: 'e164', value: '+14155550123', why: 'baseline', depth: 'quick' },
  { id: 'letters', value: 'call-me-maybe', why: 'format', depth: 'quick' },
  { id: 'too-short', value: '12', why: 'min length', depth: 'quick' },
  {
    id: 'spaces-dashes',
    value: '+1 415-555-0123',
    why: 'formatting characters',
    depth: 'standard',
  },
  { id: 'parens', value: '(415) 555-0123', why: 'national format', depth: 'standard' },
  { id: 'too-long', value: '+1415555012345678901', why: 'max length', depth: 'standard' },
  { id: 'leading-zeros', value: '0014155550123', why: '00 prefix', depth: 'standard' },
  { id: 'plus-only', value: '+', why: 'format', depth: 'standard' },
  { id: 'extension', value: '+14155550123 ext 22', why: 'extension suffix', depth: 'full' },
  { id: 'arabic-digits', value: '+٩١٩٨٧٦٥٤٣٢١٠', why: 'non-ASCII digits', depth: 'full' },
  { id: 'double-plus', value: '++14155550123', why: 'format', depth: 'full' },
  { id: 'dots', value: '415.555.0123', why: 'format', depth: 'full' },
  { id: 'local-no-country', value: '4155550123', why: 'no country code', depth: 'full' },
];

const NUMBER = [
  { id: 'empty', value: '', why: 'optional vs required', depth: 'quick' },
  { id: 'zero', value: '0', why: 'falsy value kept?', depth: 'quick' },
  { id: 'negative', value: '-1', why: 'sign', depth: 'quick' },
  { id: 'decimal', value: '1.5', why: 'integer vs decimal', depth: 'quick' },
  {
    id: 'max',
    value: (f) => String(f.maxValue ?? 2147483647),
    why: 'upper bound',
    depth: 'standard',
  },
  {
    id: 'max+1',
    value: (f) => String((f.maxValue ?? 2147483647) + 1),
    why: 'one over the bound',
    depth: 'standard',
  },
  {
    id: 'min-1',
    value: (f) => String((f.minValue ?? 0) - 1),
    why: 'one under the bound',
    depth: 'standard',
    needs: (f) => f.minValue != null,
  },
  { id: 'text', value: 'abc', why: 'not a number', depth: 'standard' },
  { id: 'exp', value: '1e3', why: 'exponent notation', depth: 'full' },
  { id: 'leading-zeros', value: '007', why: 'leading zeros', depth: 'full' },
  { id: 'thousands', value: '1,000', why: 'locale separator', depth: 'full' },
  { id: 'comma-decimal', value: '1,5', why: 'locale decimal comma', depth: 'full' },
  { id: 'huge', value: '99999999999999999999', why: 'overflow', depth: 'full' },
  { id: 'many-decimals', value: '0.123456789', why: 'precision', depth: 'full' },
  { id: 'plus-sign', value: '+5', why: 'sign', depth: 'full' },
];

const URLV = [
  { id: 'empty', value: '', why: 'optional vs required', depth: 'quick' },
  { id: 'https', value: 'https://example.com/path?x=1', why: 'baseline', depth: 'quick' },
  { id: 'no-scheme', value: 'example.com', why: 'scheme required?', depth: 'quick' },
  {
    id: 'javascript',
    value: 'javascript:alert(1)',
    why: 'dangerous scheme must be rejected or neutralised',
    depth: 'quick',
    xss: true,
  },
  { id: 'spaces', value: 'https://exam ple.com', why: 'format', depth: 'standard' },
  { id: 'ftp', value: 'ftp://example.com/file', why: 'other scheme', depth: 'standard' },
  { id: 'localhost', value: 'http://localhost:3000', why: 'internal host', depth: 'standard' },
  {
    id: 'ip',
    value: 'http://10.0.0.1/admin',
    why: 'private address (SSRF relevance)',
    depth: 'standard',
  },
  {
    id: 'data-uri',
    value: 'data:text/html,<script>window.__xss=1</script>',
    why: 'dangerous scheme',
    depth: 'full',
    xss: true,
  },
  { id: 'unicode-domain', value: 'https://exämple.com', why: 'IDN', depth: 'full' },
  {
    id: 'very-long',
    value: () => 'https://example.com/' + pad(2100),
    why: 'length',
    depth: 'full',
  },
];

const DATE = [
  { id: 'empty', value: '', why: 'optional vs required', depth: 'quick' },
  { id: 'valid', value: '2030-06-15', why: 'baseline', depth: 'quick' },
  { id: 'invalid-calendar', value: '2023-02-30', why: 'impossible date', depth: 'quick' },
  { id: 'far-past', value: '1800-01-01', why: 'lower bound', depth: 'standard' },
  { id: 'far-future', value: '9999-12-31', why: 'upper bound', depth: 'standard' },
  { id: 'leap-day', value: '2028-02-29', why: 'leap year', depth: 'standard' },
  { id: 'not-leap', value: '2027-02-29', why: 'not a leap year', depth: 'standard' },
  { id: 'us-format', value: '06/15/2030', why: 'format', depth: 'full' },
  { id: 'text', value: 'tomorrow', why: 'free text', depth: 'full' },
  {
    id: 'today',
    value: () => new Date().toISOString().slice(0, 10),
    why: 'boundary: today',
    depth: 'full',
  },
];

const PASSWORD = [
  { id: 'empty', value: '', why: 'required', depth: 'quick' },
  { id: 'short', value: 'Ab1!', why: 'minimum length', depth: 'quick' },
  { id: 'valid', value: 'Str0ng!Passw0rd#2030', why: 'baseline', depth: 'quick' },
  { id: 'no-digit', value: 'OnlyLettersHere!!', why: 'composition rule', depth: 'standard' },
  { id: 'spaces', value: '          ', why: 'whitespace-only', depth: 'standard' },
  {
    id: 'max',
    value: (f) => pad(f.max ?? 128, 'A') + '1!',
    why: 'upper length',
    depth: 'standard',
  },
  { id: 'unicode', value: 'Pässwörd-密码-1!', why: 'non-ASCII', depth: 'full' },
  { id: 'common', value: 'password', why: 'denylist', depth: 'full' },
  {
    id: 'very-long',
    value: () => pad(2000, 'A') + '1!',
    why: 'DoS / hashing limit (bcrypt 72 bytes)',
    depth: 'full',
  },
];

const CATALOGUE = {
  text: TEXT,
  name: TEXT,
  textarea: TEXT,
  slug: TEXT,
  company: TEXT,
  address: TEXT,
  search: TEXT,
  email: EMAIL,
  phone: PHONE,
  tel: PHONE,
  number: NUMBER,
  integer: NUMBER,
  money: NUMBER,
  decimal: NUMBER,
  url: URLV,
  date: DATE,
  datetime: DATE,
  password: PASSWORD,
};

/** Select/checkbox/file are driven by options, not by a value list. Returns the cases for any field. */
export function casesFor(field, depth = 'full') {
  const lvl = ORDER[depth] ?? 2;
  const out = [];
  const t = field.type || 'text';
  if (t === 'select') {
    out.push({ id: 'first-option', value: { option: 'first' }, why: 'first option' });
    out.push({ id: 'last-option', value: { option: 'last' }, why: 'last option' });
    if (lvl >= 1)
      out.push({
        id: 'empty-option',
        value: { option: 'empty' },
        why: 'placeholder / none selected',
      });
    return out;
  }
  if (t === 'checkbox' || t === 'switch') {
    out.push(
      { id: 'on', value: true, why: 'checked' },
      { id: 'off', value: false, why: 'unchecked' },
    );
    return out;
  }
  if (t === 'file') return out; // file uploads are feature specific; write a custom scenario (see scenario-catalog.md)
  for (const c of CATALOGUE[t] || TEXT) {
    if ((ORDER[c.depth] ?? 2) > lvl) continue;
    if (c.needs && !c.needs(field)) continue;
    if (field.skipCases?.includes(c.id)) continue;
    out.push({ ...c, value: typeof c.value === 'function' ? c.value(field) : c.value });
  }
  // required / unique get their own dedicated cases in the form matrix; extra cases from the spec are appended last
  for (const extra of field.cases || []) out.push(extra);
  return out;
}

export const DEPTHS = ORDER;
