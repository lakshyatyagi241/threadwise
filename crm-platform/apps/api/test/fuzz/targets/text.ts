import { posix } from 'node:path';
import { canonicalizeLocalPhone, canonicalizePhone, phoneKey } from '@crm/contracts';
import { Rng, XSS_CORPUS, json, mutate, num, redos, text } from '../gen';
import { Violation, type Target } from '../engine';
import { AppError } from '../../../src/common/errors/app-error';
import { csvCell as formsCsvCell } from '../../../src/common/csv';
import {
  csvRow as broadcastCsvRow,
  type CsvRecipient,
} from '../../../src/modules/broadcasts/broadcast-csv';
import { csvLine as exportCsvLine } from '../../../src/modules/crm/contact-bulk/csv-writer';
import { detectDelimiter, parseCsv } from '../../../src/modules/crm/contact-import/csv-parser';
import { parseWizardCsv } from '../../../src/modules/campaigns/wizard/wizard-csv-parse';
import {
  countPlaceholders,
  normalizePlaceholders,
  placeholderGaps,
  prepareText,
  tokensOf,
} from '../../../src/modules/message-templates/template-variables';
import { flattenMap } from '../../../src/modules/broadcasts/payload/template-vars';
import { assemblePhone } from '../../../src/modules/broadcasts/recipient-phone';
import { normaliseLeadPhone } from '../../../src/modules/leads/lead-phone';
import {
  ISO_COUNTRIES,
  countryName,
  countryOfPhone,
  resolveCountry,
} from '../../../src/modules/wallet-message-billing/phone-country';
import { maskPhone as contactMaskPhone } from '../../../src/modules/crm/contacts/phone-mask';
import {
  maskPhone as authMaskPhone,
  safeRelativePath,
  isValidTimezone,
} from '../../../src/modules/auth/support/text';
import { isValidAllowlistEntry, ipMatches } from '../../../src/modules/auth/support/ip';
import { composeV1Phone } from '../../../src/modules/developer-rest-api-v1/resources/crm/contacts/phone';
import { hasValidPhone, storedPhone } from '../../../src/modules/storefront-builder/rules/phone';
import { sanitizeErrorText } from '../../../src/common/errors/sanitize-error';
import {
  htmlToText,
  sanitizeEmailHtml,
} from '../../../src/infra/providers/channel-email/html-sanitize';
import { HtmlSanitizerService } from '../../../src/modules/auth/security/html-sanitizer.service';
import { decodeCursor, encodeCursor } from '../../../src/common/pagination/cursor';
import { canonicalStorageKey, storageKeyIsOwnedBy } from '../../../src/common/storage-key-owner';

/** Parsers, sanitizers and text helpers that take user-controlled text. Pure; no database. */

const isAppError = (status: number) => (e: unknown) =>
  e instanceof AppError && e.getStatus() === status;
const FORMULA = /^[=+\-@\t\r]/;

/** The cell value a spreadsheet would read from one CSV field (RFC 4180 unquoting). */
function unquote(cell: string): string {
  return cell.startsWith('"') && cell.endsWith('"') && cell.length >= 2
    ? cell.slice(1, -1).replace(/""/g, '"')
    : cell;
}

// --- CSV -------------------------------------------------------------------------------------------------------------------------

function cellValue(r: Rng): unknown {
  const k = r.next();
  if (k < 0.7) return text(r);
  if (k < 0.78) return num(r);
  if (k < 0.84) return null;
  if (k < 0.9) return [text(r), text(r)];
  return r.chance(0.5);
}

function recipient(r: Rng): CsvRecipient {
  const d = (): Date | null => (r.chance(0.5) ? new Date(r.range(0, 4_000_000_000_000)) : null);
  return {
    name: text(r).replace(/^\ufeff+/, ''),
    phoneDigits: String(r.range(0, 1e12)),
    status: r.pick(['sent', 'failed', 'read', '', 'queued']),
    clicked: r.chance(0.3),
    queuedAt: new Date(r.range(0, 4_000_000_000_000)),
    sentAt: d(),
    deliveredAt: d(),
    readAt: d(),
    failedAt: d(),
    error: r.chance(0.3) ? null : text(r),
  };
}

// --- HTML oracle -----------------------------------------------------------------------------------------------------------------

const NAMED: Record<string, string> = {
  colon: ':',
  tab: '\t',
  newline: '\n',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  sol: '/',
  lpar: '(',
  rpar: ')',
};
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, b: string) => {
    if (b[0] === '#') {
      const n = b[1]!.toLowerCase() === 'x' ? parseInt(b.slice(2), 16) : parseInt(b.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return NAMED[b.toLowerCase()] ?? m;
  });
const FORBIDDEN_TAG =
  /<\s*\/?\s*(script|style|iframe|object|embed|svg|math|form|frame|frameset|link|meta|base|applet|template|noscript|textarea|input|button|select|audio|video|source|track|title|head|portal|dialog)\b/i;

/** Why markup would run or load something in a browser, or null. Tags are well formed, because the serialiser of the sanitiser wrote them. */
function unsafeMarkup(html: string, schemes: readonly string[]): string | null {
  if (FORBIDDEN_TAG.test(html)) return 'a forbidden tag survived';
  for (const tag of html.matchAll(/<([a-z][^\s/>]*)([^>]*)>/gi)) {
    // Attribute names only: a quoted value that happens to read like `onr=` is text.
    const raw = tag[2]!;
    const attrs = raw.replace(/"[^"]*"|'[^']*'/g, '""');
    if (/(^|[\s"'/])on[a-z]+\s*=/i.test(attrs)) return `an event handler survived in <${tag[1]}>`;
    if (/(^|[\s"'/])style\s*=/i.test(attrs)) return `a style attribute survived in <${tag[1]}>`;
    for (const a of raw.matchAll(
      /\b(href|src|action|formaction|xlink:href|data|poster|background|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    )) {
      // What a browser does before it reads the scheme: drop leading control characters and spaces, and tab, CR and LF anywhere.
      const value = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(new RegExp('^[\\u0000-\\u0020]+'), '')
        .replace(new RegExp('[\\t\\r\\n]', 'g'), '')
        .toLowerCase();
      const scheme = /^([a-z][a-z0-9+.-]*):/.exec(value);
      if (scheme && !schemes.includes(scheme[1]!)) return `a ${scheme[1]}: URL survived in ${a[1]}`;
      if (!scheme && value.startsWith('//')) return `a protocol-relative URL survived in ${a[1]}`;
    }
  }
  return null;
}

function htmlText(r: Rng): string {
  const k = r.next();
  if (k < 0.35) return r.pick(XSS_CORPUS);
  if (k < 0.65) return mutate(r, r.pick(XSS_CORPUS));
  if (k < 0.8) return `<p>${text(r)}</p>${r.pick(XSS_CORPUS)}<b>${text(r)}</b>`;
  if (k < 0.88) return redos(r);
  if (k < 0.95)
    return Array.from({ length: r.range(2, 5) }, () => r.pick(XSS_CORPUS)).join(
      r.pick(['', ' ', '\n', '<p>']),
    );
  return text(r);
}

// --- secrets in error text -------------------------------------------------------------------------------------------------------

const SECRET_FORMS: ReadonlyArray<(s: string) => string> = [
  (s) => `Authorization: Bearer ${s}`,
  (s) => `authorization: Basic ${s}`,
  (s) => `password=${s}`,
  (s) => `"api_key": "${s}"`,
  (s) => `access_token:${s}`,
  (s) => `client_secret = '${s}'`,
  (s) => `https://api.example.com/v1/send?token=${s}&to=1`,
  (s) => `refresh-token=${s}`,
  (s) => `secret: ${s}`,
  (s) => `signature=${s}`,
];

export function textTargets(): Target[] {
  const t: Target[] = [];

  t.push({
    name: 'csv:forms-cell-formula',
    group: 'text',
    weight: 20,
    gen: cellValue,
    run: (v) => {
      const cell = formsCsvCell(v);
      const value = unquote(cell);
      if (FORMULA.test(value))
        throw new Violation(`a CSV cell reads as a formula: ${JSON.stringify(value.slice(0, 40))}`);
      if (typeof v === 'string' && value !== v && value !== `'${v}`)
        throw new Violation('a CSV cell does not round-trip');
      if (cell.includes('\n') && !cell.startsWith('"'))
        throw new Violation('a cell with a line break is not quoted');
    },
  });

  t.push({
    name: 'csv:broadcast-recipient-row',
    group: 'text',
    weight: 15,
    gen: recipient,
    run: (v) => {
      const row = broadcastCsvRow(v as CsvRecipient, 'UTC');
      const parsed = parseCsv(row, ',');
      if (parsed.records.length !== 1)
        throw new Violation(`one recipient became ${parsed.records.length} CSV records`);
      const cells = parsed.records[0]!.cells;
      if (cells.length !== 11)
        throw new Violation(`one recipient became ${cells.length} CSV cells`);
      for (const i of [0, 10])
        if (FORMULA.test(cells[i]!))
          throw new Violation(`recipient CSV column ${i} reads as a formula`);
    },
  });

  t.push({
    name: 'csv:contact-export-roundtrip',
    group: 'text',
    weight: 15,
    gen: (r) => Array.from({ length: r.range(1, 5) }, () => text(r)),
    run: (v) => {
      const cells = v as string[];
      const parsed = parseCsv(exportCsvLine(cells), ',');
      const got = parsed.records[0]?.cells;
      // A row whose every cell is empty is a blank line, which the reader skips on purpose.
      if (cells.every((c) => c === '') || cells[0]!.startsWith('\ufeff')) return; // a leading BOM is stripped on purpose
      if (
        parsed.records.length !== 1 ||
        !got ||
        got.length !== cells.length ||
        got.some((c, i) => c !== cells[i])
      )
        throw new Violation('an exported CSV row does not read back as the same cells');
    },
  });

  t.push({
    name: 'csv:import-parse',
    group: 'text',
    weight: 25,
    budgetMs: 2500, // linear: about 4 MB a second, and the generator makes inputs of 3 MB
    eachInput: true,
    gen: (r) =>
      r.chance(0.5)
        ? text(r)
        : Array.from({ length: r.range(1, 8) }, () => text(r)).join(
            r.pick([',', ';', '\t', '|', '\r\n', '\n', '"']),
          ),
    run: (v) => {
      const raw = v as string;
      const d = detectDelimiter(raw);
      const out = parseCsv(raw);
      if (out.delimiter !== d)
        throw new Violation('parseCsv used a delimiter other than the detected one');
      let last = 0;
      let chars = 0;
      for (const rec of out.records) {
        if (!Number.isInteger(rec.line) || rec.line < last || rec.line < 1)
          throw new Violation('CSV record lines are not increasing positive integers');
        last = rec.line;
        for (const c of rec.cells) {
          if (typeof c !== 'string') throw new Violation('a CSV cell is not a string');
          chars += c.length;
        }
      }
      if (chars > raw.length) throw new Violation('the cells hold more characters than the file');
    },
  });

  t.push({
    name: 'csv:wizard-number-list',
    group: 'text',
    weight: 20,
    budgetMs: 2500, // linear: about 4 MB a second, and the generator makes inputs of 3 MB
    eachInput: true,
    gen: (r) => {
      const header = r.pick([
        'phone',
        'phone,name',
        'mobile;name',
        'name,phone',
        'Phone,First Name,Last Name,Country Code',
        text(r),
      ]);
      const rows = Array.from(
        { length: r.range(0, 12) },
        () => `${text(r).slice(0, 40)},${text(r).slice(0, 20)}`,
      );
      return `${header}\n${rows.join(r.pick(['\n', '\r\n', '\r']))}`;
    },
    allow: (e) => e instanceof AppError && [413, 422].includes(e.getStatus()),
    run: (v) => {
      const out = parseWizardCsv(v as string, '+91');
      if (out.valid + out.duplicate + out.invalid !== out.lines.length)
        throw new Violation('valid + duplicate + invalid is not the number of lines');
      const seen = new Set<string>();
      for (const l of out.lines) {
        if (l.kind === 'valid') {
          if (!l.phone || !/^\+[1-9]\d{7,14}$/.test(l.phone))
            throw new Violation(`a valid line carries ${l.phone}`);
          if (l.digits !== l.phone.slice(1)) throw new Violation('digits do not match the phone');
          if (seen.has(l.digits)) throw new Violation('the same number is valid twice');
          seen.add(l.digits);
        }
      }
    },
  });

  // --- templates --------------------------------------------------------------------------------------------------------------

  t.push({
    name: 'tpl:placeholders',
    group: 'text',
    weight: 20,
    budgetMs: 300,
    gen: (r) => {
      const parts = Array.from({ length: r.range(0, 6) }, () =>
        r.pick([
          `{{${r.pick(['1', '2', '3', 'a', 'first_name', ' x ', '9', '10', 'a-b', ''])}}}`,
          text(r).slice(0, 30),
          '{{',
          '}}',
        ]),
      );
      return (r.chance(0.7) ? parts.join(r.pick(['', ' '])) : text(r)).slice(0, 200_000); // a template field is small
    },
    run: (v) => {
      const s = v as string;
      const n = normalizePlaceholders(s);
      if (countPlaceholders(n.text) !== countPlaceholders(s))
        throw new Violation('normalising changed the number of placeholders');
      const again = normalizePlaceholders(n.text);
      if (again.text !== n.text) throw new Violation('normalising twice is not the same as once');
      if (tokensOf(n.text).some((tk) => !/^\d+$/.test(tk)))
        throw new Violation('a named placeholder survived normalising');
      if (placeholderGaps(n.text).length > 0)
        throw new Violation('a normalised text has a gap in its placeholder numbers');
      prepareText({ header: s, body: s, footer: s });
    },
  });

  t.push({
    name: 'tpl:variable-map',
    group: 'text',
    weight: 15,
    gen: (r) => json(r),
    run: (v) => {
      const out = flattenMap(v);
      if (Object.getPrototypeOf(out) !== Object.prototype)
        throw new Violation('flattenMap returned an object with another prototype');
      for (const x of Object.values(out))
        if (typeof x !== 'string') throw new Violation('flattenMap returned a non-string value');
    },
  });

  // --- phone numbers ----------------------------------------------------------------------------------------------------------

  t.push({
    name: 'phone:canonical',
    group: 'text',
    weight: 25,
    gen: (r) => [
      text(r).slice(0, 100_000), // a phone field is short; the schema caps it
      r.chance(0.5)
        ? text(r).slice(0, 8)
        : r.pick(['+91', '91', '+1', '', null, '+999', '+0', '++1']),
    ],
    run: (v) => {
      const [raw, cc] = v as [string, string | null];
      for (const p of [canonicalizeLocalPhone(raw, cc), normaliseLeadPhone(raw, cc)]) {
        if (p === null) continue;
        if (!/^\+[1-9]\d{4,14}$/.test(p.e164) || p.digits !== p.e164.slice(1))
          throw new Violation(`a canonical phone is ${p.e164}`);
        if (canonicalizePhone({ number: p.e164 })?.e164 !== p.e164)
          throw new Violation('canonicalising a canonical phone changes it');
      }
      const key = phoneKey(raw, cc);
      if (key !== null && !/^\+[1-9]\d{4,14}$/.test(key))
        throw new Violation(`a phone key is ${key}`);
      const v1 = composeV1Phone(raw, cc);
      if (v1 !== null && !/^\+[1-9]\d{4,14}$/.test(v1))
        throw new Violation(`composeV1Phone returned ${v1}`);
      if (!/^\d*$/.test(assemblePhone(raw, cc)))
        throw new Violation('assemblePhone returned non-digits');
      if (typeof hasValidPhone(raw) !== 'boolean' || /[^\d+]/.test(storedPhone(raw)))
        throw new Violation('storefront phone rules misbehaved');
    },
  });

  t.push({
    name: 'phone:country-and-mask',
    group: 'text',
    weight: 15,
    gen: (r) => [text(r), r.range(-3, 12)],
    run: (v) => {
      const [raw, visible] = v as [string, number];
      const c = countryOfPhone(raw);
      if (c !== null && !ISO_COUNTRIES.includes(c))
        throw new Violation(`countryOfPhone returned ${c}`);
      const rc = resolveCountry(raw);
      if (rc !== null && rc !== '' && !ISO_COUNTRIES.includes(rc))
        throw new Violation(`resolveCountry returned ${rc}`);
      if (typeof countryName(raw) !== 'string')
        throw new Violation('countryName did not return a string');
      const digits = (s: string) => (s.match(/\d/g) ?? []).length;
      const masked = contactMaskPhone(raw, visible);
      if (digits(masked) > 4)
        throw new Violation(`contact maskPhone left ${digits(masked)} digits visible`);
      if (digits(authMaskPhone(raw)) > 4)
        throw new Violation('auth maskPhone left more than 4 digits visible');
    },
  });

  // --- redirects, allow-lists, keys -------------------------------------------------------------------------------------------

  t.push({
    name: 'redirect:safe-relative-path',
    group: 'text',
    weight: 15,
    gen: (r) =>
      r.chance(0.5)
        ? `/${r.pick(['', '\t', '\n', '\r', '\\', '/', ' ', '\u0000', '%2f', '%5c', '\u2028'])}${text(r).slice(0, 30)}`
        : text(r),
    run: (v) => {
      const out = safeRelativePath(v as string);
      if (out === null) return;
      const base = 'https://app.example.com';
      let origin: string;
      try {
        origin = new URL(out, base).origin;
      } catch {
        throw new Violation('a "safe" path is not a URL a browser can resolve');
      }
      if (origin !== base) throw new Violation(`a "safe" relative path resolves to ${origin}`);
    },
  });

  t.push({
    name: 'authz:storage-key-owner',
    group: 'text',
    weight: 20,
    gen: (r) => {
      const org = r.range(1, 20);
      const victim = r.chance(0.5) ? org : r.range(1, 20);
      const prefix = r.pick(['', '/', ' ', 'storage/', '//', '\t', ' /storage/']);
      const area = r.pick(['chat', 'media', 'exports', 'a']);
      const tail = r.pick([
        'x.png',
        '../8/x',
        './x',
        '%2e%2e/8/x',
        '..\\8\\x',
        'a//b',
        '',
        'a/../../9/x',
        'x\u0000.png',
        '\u202e',
      ]);
      return [
        org,
        r.chance(0.8)
          ? `${prefix}${area}/${victim}/${tail}`
          : mutate(r, `${prefix}${area}/${victim}/${tail}`),
      ];
    },
    run: (v) => {
      const [org, key] = v as [number, string];
      if (!storageKeyIsOwnedBy(org, key)) return;
      const canonical = canonicalStorageKey(key);
      const resolved = posix.normalize(`/${canonical}`).split('/');
      if (resolved[2] !== String(org) && Number(resolved[2]) !== org)
        throw new Violation(
          `key ${JSON.stringify(key)} is owned by ${org} but resolves to ${resolved.slice(0, 3).join('/')}`,
        );
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f\u007f]/.test(canonical))
        throw new Violation('an owned storage key holds a control character');
    },
  });

  t.push({
    name: 'misc:ip-allowlist-and-timezone',
    group: 'text',
    weight: 10,
    gen: (r) => [
      text(r),
      r.chance(0.5)
        ? text(r)
        : r.pick(['10.0.0.0/8', '::1', '0.0.0.0/0', '1.2.3.4', '2001:db8::/32']),
    ],
    run: (v) => {
      const [a, b] = v as [string, string];
      // An entry that is not valid must never match anything (a typo must not widen access).
      if (!isValidAllowlistEntry(a) && ipMatches(b, a))
        throw new Violation(`the invalid allow-list entry ${JSON.stringify(a)} matched ${b}`);
      if (typeof isValidTimezone(a) !== 'boolean')
        throw new Violation('isValidTimezone did not return a boolean');
    },
  });

  // --- error text, HTML -------------------------------------------------------------------------------------------------------

  t.push({
    name: 'text:sanitize-error',
    group: 'text',
    weight: 25,
    budgetMs: 250,
    eachInput: true,
    gen: (r) => {
      const secret = `Zq${Array.from({ length: r.range(8, 40) }, () => r.pick([...'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'])).join('')}`;
      const head = r.chance(0.5) ? text(r).replace(/[\w]$/, '.') : '';
      const withSecret = r.chance(0.7);
      return {
        secret,
        input: `${head.split('\n').join(' ')} ${withSecret ? r.pick(SECRET_FORMS)(secret) : ''} ${r.chance(0.5) ? text(r).slice(0, 300) : ''}`,
        withSecret,
        max: r.pick([300, 300, 50, 10]),
      };
    },
    run: (v) => {
      const { secret, input, withSecret, max } = v as {
        secret: string;
        input: string;
        withSecret: boolean;
        max: number;
      };
      const out = sanitizeErrorText(input, max);
      if (typeof out !== 'string' || out.length > max)
        throw new Violation('sanitizeErrorText exceeded its length');
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f\u007f]/.test(out))
        throw new Violation('sanitizeErrorText left a control character');
      if (withSecret && out.includes(secret))
        throw new Violation(`a secret survived sanitizeErrorText: ${input.slice(0, 80)}`);
      sanitizeErrorText(new Error(input), max);
      sanitizeErrorText(json(Rng.for(1, 'x', input.length)), max);
    },
  });

  t.push({
    name: 'html:email-sanitizer',
    group: 'text',
    weight: 40,
    budgetMs: 400,
    eachInput: true,
    gen: (r) => [htmlText(r), r.chance(0.5), r.pick([200, 5000, 200_000])],
    run: (v) => {
      const [raw, block, max] = v as [string, boolean, number];
      const out = sanitizeEmailHtml(raw, {
        blockRemoteImages: block,
        inputMaxChars: max,
        cidToAttachmentId: new Map([['a', 'att-1']]),
      });
      const bad = unsafeMarkup(out.html, ['http', 'https', 'mailto', 'tel', 'cid']);
      if (bad) throw new Violation(`sanitizeEmailHtml: ${bad}`);
      const plain = htmlToText(out.html);
      if (typeof plain !== 'string') throw new Violation('htmlToText did not return a string');
    },
  });

  const rich = new HtmlSanitizerService();
  t.push({
    name: 'html:rich-text-sanitizer',
    group: 'text',
    weight: 40,
    budgetMs: 1500, // linear: about 0.4 MB a second; the generator makes inputs up to 500 KB
    eachInput: true,
    gen: (r) => htmlText(r),
    run: (v) => {
      const out = rich.sanitize(v as string);
      const bad = unsafeMarkup(out, ['http', 'https', 'mailto', 'tel']);
      if (bad) throw new Violation(`HtmlSanitizerService: ${bad}`);
      if (
        rich.sanitize(out) !== out &&
        unsafeMarkup(rich.sanitize(out), ['http', 'https', 'mailto', 'tel'])
      )
        throw new Violation('sanitising the output again found unsafe markup');
    },
  });

  // --- pagination cursor ------------------------------------------------------------------------------------------------------

  t.push({
    name: 'page:cursor-decode',
    group: 'text',
    weight: 25,
    gen: (r) => {
      const k = r.next();
      if (k < 0.3)
        return Buffer.from(
          `${r.pick(['12', '2026', '2020-01-01', 'Jan 1 2020', '1 Jan 2020 00:00 PST', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.123456Z', text(r).slice(0, 30), '+275760-09-13T00:00:00.000Z'])}|${r.pick(['1', '0', '-1', '99999999999999999999', '1e3', '0x10', '9007199254740993', '1.5', ' 7', text(r).slice(0, 10)])}`,
          'utf8',
        ).toString('base64url');
      if (k < 0.5)
        return Buffer.from(text(r), 'utf8').toString(r.pick(['base64url', 'base64', 'hex']));
      if (k < 0.65)
        return encodeCursor({
          createdAt: new Date(r.range(0, 4_000_000_000_000)),
          id: r.range(0, 2 ** 31),
        });
      return text(r);
    },
    allow: isAppError(400),
    run: (v) => {
      const c = decodeCursor(v as string);
      if (!(c.createdAt instanceof Date) || Number.isNaN(c.createdAt.getTime()))
        throw new Violation('a decoded cursor has an invalid date');
      if (!Number.isFinite(c.id) || Math.abs(c.id) >= 2 ** 63)
        throw new Violation(`a decoded cursor carries the id ${c.id}, outside Postgres bigint`);
      // The microsecond form goes into SQL as `<value>::timestamptz`: it must be an ISO timestamp Postgres reads the same way.
      if (
        c.createdAtIso !== undefined &&
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(c.createdAtIso)
      )
        throw new Violation(
          `a decoded cursor passes ${JSON.stringify(c.createdAtIso)} to SQL as a timestamp`,
        );
    },
  });

  return t;
}
