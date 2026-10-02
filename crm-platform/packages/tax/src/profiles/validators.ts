import type { TaxIdResult, TaxIdSpec } from './types';

/**
 * Tax-id validators. Each returns `{ valid, normalized, level, reason, details }`. `level: 'checksum'` means the public check-digit
 * algorithm was verified; `level: 'format'` means only the shape was (no public checksum, or not implemented). Neither proves the
 * number is REGISTERED: for that use the authority's lookup (VIES for the EU, GST portal, ABN Lookup ...).
 */

export const normalizeId = (raw: string): string => raw.replace(/[\s.\-_/]/g, '').toUpperCase();

const ok = (
  normalized: string,
  level: TaxIdResult['level'],
  details?: Record<string, string>,
): TaxIdResult => ({
  valid: true,
  normalized,
  level,
  ...(details ? { details } : {}),
});
const bad = (
  normalized: string,
  reason: string,
  level: TaxIdResult['level'] = 'format',
): TaxIdResult => ({
  valid: false,
  normalized,
  level,
  reason,
});

const digits = (s: string): number[] => [...s].map((c) => Number(c));

function luhnValid(s: string): boolean {
  let total = 0;
  [...s].reverse().forEach((c, i) => {
    let v = Number(c) * (i % 2 === 1 ? 2 : 1);
    if (v > 9) v -= 9;
    total += v;
  });
  return total % 10 === 0;
}

// --- India ---------------------------------------------------------------------------------------------------------------

export const INDIA_STATE_CODES = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
  '24',
  '26',
  '27',
  '28',
  '29',
  '30',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
  '97',
  '99',
] as const;

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The mod-36 check character of a GSTIN's first 14 characters. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
}

export const PAN_ENTITY: Readonly<Record<string, string>> = {
  P: 'Individual',
  C: 'Company',
  H: 'Hindu Undivided Family',
  F: 'Firm / LLP',
  A: 'Association of Persons',
  B: 'Body of Individuals',
  G: 'Government',
  J: 'Artificial Juridical Person',
  L: 'Local Authority',
  T: 'Trust',
};

export function validatePan(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(n))
    return bad(n, 'A PAN is 5 letters, 4 digits, 1 letter (e.g. AABCT1332L).');
  if (!(n[3]! in PAN_ENTITY))
    return bad(
      n,
      'The 4th character of a PAN must be a holder type (P, C, H, F, A, B, G, J, L, T).',
    );
  return ok(n, 'format', { holderType: PAN_ENTITY[n[3]!]! });
}

export function validateGstin(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  if (n.length !== 15) return bad(n, 'A GSTIN has 15 characters.');
  const m = /^(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])(Z)([0-9A-Z])$/.exec(n);
  if (!m)
    return bad(
      n,
      'Format: 2-digit state code, 10-character PAN, entity number, "Z", check character.',
    );
  if (!(INDIA_STATE_CODES as readonly string[]).includes(m[1]!))
    return bad(n, `"${m[1]}" is not a GST state code.`);
  const pan = validatePan(m[2]!);
  if (!pan.valid) return bad(n, `The PAN inside the GSTIN is invalid: ${pan.reason}`);
  if (gstinCheckChar(n.slice(0, 14)) !== n[14])
    return bad(n, 'The GSTIN check character does not match.', 'checksum');
  return ok(n, 'checksum', {
    stateCode: m[1]!,
    pan: m[2]!,
    entityNumber: m[3]!,
    holderType: pan.details!['holderType']!,
  });
}

// --- Gulf ----------------------------------------------------------------------------------------------------------------

export function validateUaeTrn(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  if (!/^\d{15}$/.test(n)) return bad(n, 'A UAE TRN has 15 digits.');
  if (!n.startsWith('100')) return bad(n, 'A UAE TRN starts with 100.');
  return ok(n, 'format');
}

export function validateSaudiVat(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  if (!/^\d{15}$/.test(n)) return bad(n, 'A Saudi VAT number has 15 digits.');
  if (!(n.startsWith('3') && n.endsWith('3')))
    return bad(n, 'A Saudi VAT number starts and ends with 3.');
  return ok(n, 'format');
}

export function validateBahrainVat(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  if (!/^\d{15}$/.test(n)) return bad(n, 'A Bahrain VAT account number has 15 digits.');
  return ok(n, 'format');
}

export function validateOmanVat(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  if (!/^OM\d{10}$/.test(n)) return bad(n, 'An Omani VATIN is "OM" followed by 10 digits.');
  return ok(n, 'format');
}

// --- UK / EU -------------------------------------------------------------------------------------------------------------

function ukModulus(nine: string): boolean {
  const d = digits(nine);
  const total = d.slice(0, 7).reduce((a, x, i) => a + x * (8 - i), 0);
  const check = d[7]! * 10 + d[8]!;
  return (total + check) % 97 === 0 || (total + check + 55) % 97 === 0;
}

/** GB (and XI for Northern Ireland) VAT numbers: 9 digits with the mod-97 check, 12 digits (branch), GD### or HA###. */
export function validateUkVat(raw: string): TaxIdResult {
  let n = normalizeId(raw);
  let prefix = 'GB';
  if (n.startsWith('GB') || n.startsWith('XI')) {
    prefix = n.slice(0, 2);
    n = n.slice(2);
  }
  const full = prefix + n;
  if (/^GD\d{3}$/.test(n))
    return Number(n.slice(2)) < 500
      ? ok(full, 'format')
      : bad(full, 'GD numbers run from GD000 to GD499.');
  if (/^HA\d{3}$/.test(n))
    return Number(n.slice(2)) >= 500
      ? ok(full, 'format')
      : bad(full, 'HA numbers run from HA500 to HA999.');
  if (!/^\d{9}(\d{3})?$/.test(n))
    return bad(full, 'A UK VAT number is 9 digits (or 12 with a branch suffix), GD### or HA###.');
  if (!ukModulus(n.slice(0, 9)))
    return bad(full, 'The UK VAT check digits do not match.', 'checksum');
  return ok(full, 'checksum');
}

interface EuSpec {
  re: RegExp;
  check?: (body: string) => boolean;
  example: string;
}

const deCheck = (b: string): boolean => {
  let p = 10;
  for (const x of digits(b.slice(0, 8))) {
    let t = (x + p) % 10;
    if (t === 0) t = 10;
    p = (2 * t) % 11;
  }
  const c = 11 - p === 10 ? 0 : 11 - p;
  return c === Number(b[8]);
};
const frCheck = (b: string): boolean => {
  if (!/^\d{2}\d{9}$/.test(b)) return true; // alphanumeric keys (old numbering) have no public check
  return Number(b.slice(0, 2)) === (12 + 3 * (Number(b.slice(2)) % 97)) % 97;
};
const itCheck = (b: string): boolean => luhnValid(b);
const beCheck = (b: string): boolean => 97 - (Number(b.slice(0, 8)) % 97) === Number(b.slice(8));
const plCheck = (b: string): boolean => {
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const d = digits(b);
  const s = w.reduce((a, x, i) => a + x * d[i]!, 0) % 11;
  return s === d[9];
};

/** VAT-ID shapes by VIES prefix (Greece is EL). Format per country; a few also verify the public check digit. */
export const EU_VAT_FORMATS: Readonly<Record<string, EuSpec>> = {
  AT: { re: /^U\d{8}$/, example: 'ATU12345675' },
  BE: { re: /^[01]\d{9}$/, check: beCheck, example: 'BE0403019261' },
  BG: { re: /^\d{9,10}$/, example: 'BG123456789' },
  HR: { re: /^\d{11}$/, example: 'HR12345678901' },
  CY: { re: /^\d{8}[A-Z]$/, example: 'CY12345678A' },
  CZ: { re: /^\d{8,10}$/, example: 'CZ12345678' },
  DE: { re: /^\d{9}$/, check: deCheck, example: 'DE136695976' },
  DK: { re: /^\d{8}$/, example: 'DK12345678' },
  EE: { re: /^\d{9}$/, example: 'EE123456789' },
  EL: { re: /^\d{9}$/, example: 'EL123456789' },
  ES: { re: /^[A-Z0-9]\d{7}[A-Z0-9]$/, example: 'ESA12345674' },
  FI: { re: /^\d{8}$/, example: 'FI12345678' },
  FR: { re: /^[A-Z0-9]{2}\d{9}$/, check: frCheck, example: 'FR40303265045' },
  HU: { re: /^\d{8}$/, example: 'HU12345678' },
  IE: { re: /^(\d{7}[A-W][A-I]?|\d[A-Z+*]\d{5}[A-W])$/, example: 'IE1234567T' },
  IT: { re: /^\d{11}$/, check: itCheck, example: 'IT00743110157' },
  LT: { re: /^(\d{9}|\d{12})$/, example: 'LT123456789' },
  LU: { re: /^\d{8}$/, example: 'LU12345678' },
  LV: { re: /^\d{11}$/, example: 'LV12345678901' },
  MT: { re: /^\d{8}$/, example: 'MT12345678' },
  NL: { re: /^\d{9}B\d{2}$/, example: 'NL123456789B01' },
  PL: { re: /^\d{10}$/, check: plCheck, example: 'PL5260250995' },
  PT: { re: /^\d{9}$/, example: 'PT123456789' },
  RO: { re: /^\d{2,10}$/, example: 'RO1234567890' },
  SE: { re: /^\d{12}$/, example: 'SE123456789001' },
  SI: { re: /^\d{8}$/, example: 'SI12345678' },
  SK: { re: /^\d{10}$/, example: 'SK1234567890' },
  XI: { re: /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/, example: 'XI123456789' },
};

/** ISO alpha-2 of a member state -> VIES prefix. */
export const euVatPrefix = (iso2: string): string =>
  iso2.toUpperCase() === 'GR' ? 'EL' : iso2.toUpperCase();

/**
 * VIES-style VAT-ID validation. `countryHint` (ISO alpha-2 of the member state) is used when the number has no prefix. A mismatch
 * between a given prefix and the hint is reported. Format (and for DE, FR, IT, BE, PL the check digits) only.
 */
export function validateEuVatId(raw: string, countryHint?: string): TaxIdResult {
  const n = normalizeId(raw);
  const hint = countryHint ? euVatPrefix(countryHint) : undefined;
  const prefix = /^[A-Z]{2}/.test(n) && n.slice(0, 2) in EU_VAT_FORMATS ? n.slice(0, 2) : undefined;
  const cc = prefix ?? hint;
  if (!cc || !(cc in EU_VAT_FORMATS))
    return bad(n, 'Start the VAT number with the 2-letter EU country prefix (Greece: EL).');
  if (prefix && hint && prefix !== hint)
    return bad(n, `The prefix ${prefix} does not match the country ${hint}.`);
  const body = prefix ? n.slice(2) : n;
  const spec = EU_VAT_FORMATS[cc]!;
  if (!spec.re.test(body))
    return bad(cc + body, `Not a valid ${cc} VAT number format (example ${spec.example}).`);
  if (spec.check && !spec.check(body))
    return bad(cc + body, `The ${cc} VAT check digits do not match.`, 'checksum');
  return ok(cc + body, spec.check ? 'checksum' : 'format', { country: cc });
}

// --- North America -------------------------------------------------------------------------------------------------------

export function validateUsEin(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  if (!/^\d{9}$/.test(n)) return bad(n, 'A US EIN has 9 digits (NN-NNNNNNN).');
  return ok(n, 'format');
}

/** Canada Revenue Agency business number (9 digits, Luhn) with the optional RT0001 GST/HST program account. */
export function validateCaGstHst(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  const m = /^(\d{9})(RT\d{4})?$/.exec(n);
  if (!m) return bad(n, 'A GST/HST number is a 9-digit business number followed by RT0001.');
  if (!luhnValid(m[1]!))
    return bad(n, 'The business number check digit does not match.', 'checksum');
  return ok(n, 'checksum', { businessNumber: m[1]! });
}

export function validateCaQst(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  if (!/^\d{10}TQ\d{4}$/.test(n))
    return bad(n, 'A Quebec QST number is 10 digits followed by TQ0001.');
  return ok(n, 'format');
}

export function validateMexRfc(raw: string): TaxIdResult {
  const n = normalizeId(raw).replace(/[^A-Z0-9&Ñ]/g, '');
  const m = /^([A-ZÑ&]{3,4})(\d{2})(\d{2})(\d{2})([A-Z0-9]{3})$/.exec(n);
  if (!m)
    return bad(n, 'An RFC is 3-4 letters, a 6-digit date (YYMMDD) and a 3-character homoclave.');
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31)
    return bad(n, 'The date inside the RFC is not a valid date.');
  return ok(n, 'format', { holder: m[1]!.length === 3 ? 'company' : 'individual' });
}

// --- Asia-Pacific --------------------------------------------------------------------------------------------------------

export function validateAbn(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  if (!/^\d{11}$/.test(n)) return bad(n, 'An ABN has 11 digits.');
  const d = digits(n);
  d[0] = d[0]! - 1;
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  if (d.reduce((a, x, i) => a + x * w[i]!, 0) % 89 !== 0)
    return bad(n, 'The ABN check digits do not match.', 'checksum');
  return ok(n, 'checksum');
}

/** New Zealand IRD number (8 or 9 digits, mod-11 with a secondary weight set). */
export function validateNzIrd(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  if (!/^\d{8,9}$/.test(n)) return bad(n, 'An IRD number has 8 or 9 digits.');
  const padded = n.padStart(9, '0');
  const value = Number(padded);
  if (value < 10_000_000 || value > 150_000_000)
    return bad(n, 'IRD numbers run from 10-000-000 to 150-000-000.');
  const d = digits(padded);
  for (const w of [
    [3, 2, 7, 6, 5, 4, 3, 2],
    [7, 4, 3, 2, 5, 2, 7, 6],
  ]) {
    const r = w.reduce((a, x, i) => a + x * d[i]!, 0) % 11;
    const c = r === 0 ? 0 : 11 - r;
    if (c < 10)
      return c === d[8]
        ? ok(padded, 'checksum')
        : bad(n, 'The IRD check digit does not match.', 'checksum');
  }
  return bad(n, 'The IRD check digit does not match.', 'checksum');
}

export function validateSgGst(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  if (
    /^(\d{8}[A-Z]|\d{9}[A-Z]|[TSR]\d{2}[A-Z]{2}\d{4}[A-Z]|M[29]\d{7}[A-Z0-9]|M\d{8}[A-Z])$/.test(n)
  )
    return ok(n, 'format');
  return bad(
    n,
    'A Singapore GST number is a UEN (e.g. 201912345A, T08LL0001A) or an M2/M9 GST registration number.',
  );
}

export function validateMySst(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  if (!/^[A-Z]\d{2}\d{4}\d{8}$/.test(n))
    return bad(n, 'A Malaysian SST number looks like W10-1808-32000123.');
  return ok(n, 'format');
}

/** Japan qualified-invoice registration number: "T" + 13-digit corporate number (check digit first). */
export function validateJpInvoiceNo(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  const m = /^T(\d{13})$/.exec(n);
  if (!m) return bad(n, 'A Japanese invoice registration number is "T" followed by 13 digits.');
  const d = digits(m[1]!);
  let total = 0;
  for (let k = 1; k <= 12; k++) total += d[13 - k]! * (k % 2 === 1 ? 1 : 2);
  if (d[0] !== 9 - (total % 9))
    return bad(n, 'The corporate-number check digit does not match.', 'checksum');
  return ok(n, 'checksum');
}

// --- Africa ---------------------------------------------------------------------------------------------------------------

export function validateZaVat(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  if (!/^4\d{9}$/.test(n))
    return bad(n, 'A South African VAT number has 10 digits and starts with 4.');
  return ok(n, 'format');
}

export function validateNgTin(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  if (!/^\d{8,14}$/.test(n)) return bad(n, 'A Nigerian TIN has 8 to 14 digits.');
  return ok(n, 'format');
}

export function validateKePin(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  if (!/^[AP]\d{9}[A-Z]$/.test(n))
    return bad(n, 'A KRA PIN is A or P, 9 digits, 1 letter (e.g. P051234567Z).');
  return ok(n, 'format');
}

// --- Brazil (bonus, used by the note-only profile) ------------------------------------------------------------------------

export function validateCnpj(raw: string): TaxIdResult {
  const n = normalizeId(raw);
  if (!/^\d{14}$/.test(n) || /^(\d)\1{13}$/.test(n)) return bad(n, 'A CNPJ has 14 digits.');
  const d = digits(n);
  const dv = (len: number, ws: number[]) => {
    const r = d.slice(0, len).reduce((a, x, i) => a + x * ws[i]!, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, ...w1];
  if (dv(12, w1) !== d[12] || dv(13, w2) !== d[13])
    return bad(n, 'The CNPJ check digits do not match.', 'checksum');
  return ok(n, 'checksum');
}

// --- spec factory ---------------------------------------------------------------------------------------------------------

export const idSpec = (
  id: string,
  label: string,
  example: string,
  validate: (raw: string) => TaxIdResult,
): TaxIdSpec => ({
  id,
  label,
  example,
  validate,
});

export const ID_SPECS = {
  gstin: idSpec('gstin', 'GSTIN', '27AAPFU0939F1ZV', validateGstin),
  pan: idSpec('pan', 'PAN', 'AAPFU0939F', validatePan),
  uaeTrn: idSpec('trn', 'TRN', '100123456789003', validateUaeTrn),
  saudiVat: idSpec('vat_no', 'VAT registration number', '300000000000003', validateSaudiVat),
  bahrainVat: idSpec('vat_no', 'VAT account number', '200000000000002', validateBahrainVat),
  omanVat: idSpec('vatin', 'VATIN', 'OM1100123456', validateOmanVat),
  ukVat: idSpec('vat_no', 'VAT registration number', 'GB333289454', validateUkVat),
  usEin: idSpec('ein', 'EIN', '12-3456789', validateUsEin),
  caGst: idSpec('gst_hst', 'GST/HST number', '123456782RT0001', validateCaGstHst),
  caQst: idSpec('qst', 'QST number', '1234567890TQ0001', validateCaQst),
  abn: idSpec('abn', 'ABN', '51 824 753 556', validateAbn),
  nzIrd: idSpec('ird', 'GST number (IRD)', '49-091-850', validateNzIrd),
  sgGst: idSpec('gst_reg', 'GST registration number / UEN', '201912345A', validateSgGst),
  mySst: idSpec('sst_reg', 'SST registration number', 'W10-1808-32000123', validateMySst),
  jpInvoice: idSpec(
    'invoice_reg',
    'Registration number (T number)',
    'T1180301018771',
    validateJpInvoiceNo,
  ),
  zaVat: idSpec('vat_no', 'VAT number', '4123456789', validateZaVat),
  ngTin: idSpec('tin', 'TIN', '12345678-0001', validateNgTin),
  kePin: idSpec('kra_pin', 'KRA PIN', 'P051234567Z', validateKePin),
  mexRfc: idSpec('rfc', 'RFC', 'XAXX010101000', validateMexRfc),
  cnpj: idSpec('cnpj', 'CNPJ', '11.222.333/0001-81', validateCnpj),
} as const;

export const euVatSpec = (iso2: string): TaxIdSpec =>
  idSpec(
    'vat_id',
    'VAT identification number',
    EU_VAT_FORMATS[euVatPrefix(iso2)]?.example ?? 'XX123456789',
    (raw) => validateEuVatId(raw, iso2),
  );
