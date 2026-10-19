/**
 * Seeded generator of malicious and invalid inputs (security fuzzing, QA sheet 3 item 38).
 *
 * No dependency: an sfc32 PRNG seeded through a 32-bit hash. `Rng.for(seed, target, i)` derives the generator of ONE input from
 * (seed, target name, input index), so any single input can be replayed on its own (`--target T --iter I`) without running the ones
 * before it. Everything here is a pure function of the Rng it is handed.
 */

const imul = Math.imul;

/** 32-bit FNV-1a, used to turn a name into a number. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(a: number, b: number, c: number, d: number) {
    this.a = a | 0;
    this.b = b | 0;
    this.c = c | 0;
    this.d = d | 0;
    for (let i = 0; i < 8; i += 1) this.u32(); // sfc32 warm-up
  }

  /** The generator of input `index` of target `target` under `seed`. */
  static for(seed: number, target: string, index: number): Rng {
    const t = hash32(target);
    return new Rng(
      seed ^ 0x9e3779b9,
      t,
      imul(index + 1, 0x85ebca6b) ^ t,
      index ^ imul(seed, 0xc2b2ae35),
    );
  }

  u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }
  next(): number {
    return this.u32() / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }
}

// --- strings ---------------------------------------------------------------------------------------------------------------------

const SQL = [
  "' OR '1'='1",
  "'; DROP TABLE users;--",
  '1; SELECT pg_sleep(10)--',
  "' UNION SELECT NULL,NULL,version()--",
  "\\'; SELECT 1;--",
  '" OR ""="',
  "1' AND (SELECT COUNT(*) FROM pg_tables)>0--",
  "admin'--",
  "'; COPY (SELECT '') TO PROGRAM 'id';--",
  '$$; SELECT 1; $$',
  "%' OR 1=1--",
  '1) OR (1=1',
  "'||(SELECT pg_sleep(5))||'",
];
const NOSQL = [
  '{"$ne":null}',
  '{"$gt":""}',
  '{"$where":"sleep(5000)"}',
  '{"$regex":".*"}',
  '[$ne]=1',
  'a[$ne]=b',
  '{"__proto__":{"admin":true}}',
  '{"constructor":{"prototype":{"admin":true}}}',
  '$or[0][a]=1',
];
const TEMPLATE = [
  '{{7*7}}',
  '${7*7}',
  '<%= 7*7 %>',
  '#{7*7}',
  '{{constructor.constructor("return process")()}}',
  '{{{raw}}}',
  '{{#each this}}{{/each}}',
  '{% raw %}',
  '{{ __proto__ }}',
  '{{',
  '}}',
  '{{}}',
  '{{ }}',
  '{{1}}{{2}}{{3}}',
  '{{first_name',
  '{{{{{{{{{{x}}}}}}}}}}',
  '{{a.b.c.d.e}}',
  '${jndi:ldap://127.0.0.1/a}',
  '{{\u0000}}',
  '%s%s%s%n',
];
const COMMAND = [
  '; id',
  '| id',
  '`id`',
  '$(id)',
  '&& cat /etc/passwd',
  '\n/bin/sh -c id',
  '|| ping -c 1 127.0.0.1',
  '; rm -rf /',
  '> /dev/null; id',
  '--exec=id',
  '-oProxyCommand=id',
  '$(sleep 5)',
  '%0aid',
];
const PATHS = [
  '../../../../etc/passwd',
  '..\\..\\..\\windows\\win.ini',
  '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  '..%252f..%252fetc/passwd',
  '....//....//etc/passwd',
  '/etc/passwd',
  'file:///etc/passwd',
  'C:\\Windows\\System32',
  '\\\\server\\share\\x',
  'a/../../b',
  '..;/..;/x',
  '%00.png',
  'x.png\u0000.php',
  '/proc/self/environ',
  '~root/.ssh/id_rsa',
  '.',
  '..',
  '/',
  '',
];
const URLS = [
  'http://127.0.0.1/',
  'http://localhost/',
  'http://169.254.169.254/latest/meta-data/',
  'http://metadata.google.internal/',
  'http://metadata.google.internal./computeMetadata/v1/',
  'http://METADATA.GOOGLE.INTERNAL/',
  'http://[::1]/',
  'http://[::ffff:127.0.0.1]/',
  'http://[::ffff:7f00:1]/',
  'http://[0:0:0:0:0:ffff:a9fe:a9fe]/',
  'http://[64:ff9b::7f00:1]/',
  'http://[2002:7f00:1::]/',
  'http://[fd00::1]/',
  'http://[fe80::1%25eth0]/',
  'http://2130706433/',
  'http://0x7f.0x0.0x0.0x1/',
  'http://017700000001/',
  'http://127.1/',
  'http://0/',
  'http://0.0.0.0/',
  'http://1.1.1.1.nip.io/',
  'http://127.0.0.1.nip.io/',
  'http://localtest.me/',
  'http://user:pass@127.0.0.1/',
  'http://example.com@127.0.0.1/',
  'http://127.0.0.1#@example.com/',
  'http://example.com\\@127.0.0.1/',
  'http://\u2460\u2467.0.0.1/',
  'http://127\u3002\u0030\u3002\u0030\u3002\u0031/',
  'http://localhost./',
  'http://LOCALHOST/',
  'http://a.b.internal/',
  'http://a.b.internal./',
  'http://x.local/',
  'http://100.64.0.1/',
  'http://192.0.0.192/',
  'http://[::]/',
  'http://[::1]:6379/',
  'gopher://127.0.0.1:6379/_FLUSHALL',
  'file:///etc/passwd',
  'ftp://127.0.0.1/',
  'dict://127.0.0.1:11211/stat',
  'ldap://127.0.0.1/',
  'jar:http://127.0.0.1!/',
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'https://example.com:99999/',
  'https://example.com:0/',
  'https://exa mple.com/',
  'https://example.com\u0000.evil.com/',
  'https://\uff45xample.com/',
  'https://xn--80ak6aa92e.com/',
  'https://' + 'a'.repeat(300) + '.com/',
  'https://' + 'a.'.repeat(130) + 'com/',
  '//evil.com/',
  '///evil.com/',
  'https:evil.com',
  'https:/evil.com',
  'HTTPS://EXAMPLE.COM/',
  'http://[',
  'http://]',
  'http://[1]/',
  'https://example.com/%',
  'https://example.com/\r\nHost: evil',
  'https://example.com/?a=b#c',
];
const XSS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href="  jAvAsCrIpT:alert(1)">x</a>',
  '<a href="java\tscript:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="&#x6A;&#x61;vascript:alert(1)">x</a>',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
  '<<script>script>alert(1)<</script>/script>',
  '<img src="x" onerror="alert(1)"//>',
  '<img/src=x/onerror=alert(1)>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<svg><style><img src=x onerror=alert(1)></style></svg>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<form action="javascript:alert(1)"><button>x</button></form>',
  '<body onload=alert(1)>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<style>@import "http://evil/x.css";</style>',
  '<link rel=stylesheet href=http://evil/x.css>',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<base href="javascript:alert(1)//">',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="javascript:alert(1)">',
  '<template><script>alert(1)</script></template>',
  '<a href=# onclick=alert(1)>x</a>',
  '<a title="x" onmouseover="alert(1)">x</a>',
  '<img src="cid:x" onerror=alert(1)>',
  '<!--[if IE]><script>alert(1)</script><![endif]-->',
  '<![CDATA[<script>alert(1)</script>]]>',
  '<p>unterminated <b',
  '<a href="http://example.com" target=_top>x</a>',
  '"><script>alert(1)</script>',
  "'-alert(1)-'",
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '&#60;script&#62;alert(1)&#60;/script&#62;',
  '\u003cscript\u003ealert(1)\u003c/script\u003e',
  '<\u0000script>alert(1)</script>',
  '<ScRiPt>alert(1)</sCrIpT>',
  '<script\n>alert(1)</script\n>',
  '<img src=`x` onerror=alert(1)>',
];
const CRLF = [
  'a\r\nSet-Cookie: x=1',
  'a\r\n\r\n<html>',
  'a%0d%0aX-Injected: 1',
  'a\u2028b',
  'a\u2029b',
  'a\u0085b',
  'a\rb',
  'a\nb',
];
const ODD = [
  '',
  ' ',
  '\u0000',
  'a\u0000b',
  '\u0000'.repeat(64),
  '\t',
  '\n',
  '\r\n',
  '\u000b\u000c',
  '\u001b[31m',
  '\u0007',
  '\u007f',
  '\u0080\u009f',
  '\u00a0',
  '\u200b',
  '\u200d',
  '\u2060',
  '\ufeff',
  '\ufeffa',
  '\ufffe',
  '\uffff',
  '\ufffd',
  '\u202e',
  '\u202eabc\u202c',
  '\u2066\u2067\u2068\u2069',
  '\u200f\u200e',
  'a\u202edcba',
  '\u0600\u0627\u0644\u0639\u0631\u0628\u064a\u0629',
  '\u05d0\u05d1\u05d2',
  'e\u0301\u0301\u0301\u0301\u0301\u0301\u0301\u0301',
  'Z\u0351\u036b\u0343\u036a\u0302\u036b\u033d\u034f\u0334\u0319\u0324\u031e\u0349\u035a\u032f\u031e\u0320\u034d',
  '\ud800',
  '\udc00',
  '\ud800\ud800',
  '\udc00\ud800',
  'a\ud83dz',
  '\ud83d\ude00',
  '\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d\udc66',
  '\ud83c\uddee\ud83c\uddf3',
  '\ud83c\udffb',
  '\u{1F600}'.repeat(100),
  '\u{10ffff}',
  '\u{1d11e}',
  '\uff21\uff22\uff23',
  '\uff0e\uff0e\uff0f',
  '\u2024\u2024',
  '\u0130',
  '\u1e9e',
  '\ufb01',
  '\u212a',
  '\u00c3\u00a9', // mojibake of e-acute
  '\u00ef\u00bf\u00bd', // mojibake of U+FFFD
  '%c0%af',
  '%e0%80%af',
  '%ed%a0%80',
  '%ff%fe',
  '%',
  '%zz',
  '%u0041',
  '=?UTF-8?B?QQ==?=',
  '=?utf-8?q?=00?=',
  '\\u0000',
  '\\ud800',
  '\\x00',
  'null',
  'undefined',
  'NaN',
  'true',
  'false',
  '0',
  '-0',
  '0x10',
  '1e999',
  '-1e999',
  '9007199254740993',
  '99999999999999999999999999',
  '[]',
  '{}',
  '[object Object]',
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'hasOwnProperty',
  '__defineGetter__',
  '../',
  '*',
  '?',
  '.*',
  '\\',
  '\\\\',
  '"',
  "'",
  '`',
  '$',
  '@',
  "=cmd|' /C calc'!A0",
  '=HYPERLINK("http://evil","x")',
  '+1+1',
  '-1+1',
  '@SUM(1)',
  '\t=1+1',
  '\r=1+1',
  '"=1+1"',
  'a,b"c\nd',
  'a;b|c\td',
  'x@y',
  '@',
  'a@b@c.com',
  'a@b',
  '"a b"@c.com',
  'a@[127.0.0.1]',
  'a@b..com',
  '.a@b.com',
  'a.@b.com',
  'a@-b.com',
  'a@' + 'b'.repeat(70) + '.com',
  'a'.repeat(70) + '@b.com',
  '+',
  '++',
  '+0',
  '+00',
  '00',
  '+1',
  '+91 98765 43210',
  '+91-(987)-654.3210',
  '0044 7700 900123',
  '+999999999999999999999',
  '\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669\u0660',
  '\uff0b\uff19\uff11\uff19\uff18\uff17\uff16\uff15\uff14\uff13\uff12\uff11\uff10',
  '1e5',
  '1,000.00',
  '1.000,00',
  '0.1',
  '.5',
  '5.',
  '-',
  '--',
  '2026-02-30T25:61:61Z',
  '0000-00-00',
  '2026-13-01',
  '2026-01-01T00:00:00+99:99',
  '+275760-09-13T00:00:00.000Z',
  '-271821-04-20T00:00:00.000Z',
  '+275761-01-01T00:00:00Z',
  '1970-01-01T00:00:00.000Z',
  '2026-01-01T00:00:00.000000000Z',
  '12',
  '2026',
  'Jan 1 2026',
  'Tue Jan 01 2030 00:00:00 GMT+0100 (CET)',
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '{11111111-1111-4111-8111-111111111111}',
  '11111111-1111-4111-8111-11111111111g',
  'Europe/Nowhere',
  'UTC+25',
  'Asia/Kolkata',
  'utc',
  'GMT',
];

export const CORPUS: readonly string[] = [
  ...SQL,
  ...NOSQL,
  ...TEMPLATE,
  ...COMMAND,
  ...PATHS,
  ...URLS,
  ...XSS,
  ...CRLF,
  ...ODD,
];
export const URL_CORPUS = URLS;
export const XSS_CORPUS = XSS;

const REDOS_UNITS: readonly [string, string][] = [
  ['a', '!'],
  ['a', '@'],
  ['a@', '!'],
  ['a.', '!'],
  ['a-', '!'],
  [' ', 'x'],
  ['\t', 'x'],
  ['1', 'x'],
  ['0', '.'],
  ['9.', 'x'],
  ['<', ''],
  ['<a ', ''],
  ['<a href="', ''],
  ['<!--', ''],
  ['&', ''],
  ['&#', ''],
  ['&#x', ''],
  ['{{', ''],
  ['{{ ', ''],
  ['{', ''],
  ['"', ''],
  ['""', ''],
  ['\\', ''],
  ['=', ''],
  ['+', 'x'],
  ['(', ''],
  [')', ''],
  ['[', ''],
  ['\n', ''],
  ['\r', ''],
  [',', ''],
  [';', ''],
  ['/', ''],
  ['../', ''],
  ['%', ''],
  ['%2', ''],
  ['x'.repeat(31), '_'],
  ['0123456789', ' '],
  ['+91 ', 'x'],
  ['a:', 'x'],
  ['a=b&', ''],
  ['eyJ', ''],
  ['Bearer ', ''],
  ['token=', ''],
  ['-----BEGIN ', ''],
  ['\u00e9', '!'],
  ['\u{1F600}', '!'],
];

/** A string built to make a backtracking or quadratic matcher work hard: a repeated unit and a tail that breaks the match. */
export function redos(r: Rng): string {
  const [unit, tail] = r.pick(REDOS_UNITS);
  const n = r.chance(0.05) ? r.range(20_000, 120_000) : r.range(8, 6000);
  return unit.repeat(n) + tail;
}

const ALPHABETS: readonly string[] = [
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  '0123456789',
  '0123456789+-() .',
  'abc@.:/?#[]&=%+_~-',
  '<>"\'`&;{}()[]\\/=!*$|^',
  '\u0000\u0001\u0002\u0007\u0008\u0009\u000a\u000b\u000c\u000d\u001b\u007f\u0085\u2028\u2029',
  '\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\u200b\u200c\u200d\u200e\u200f\ufeff',
  '\u00e9\u00fc\u00f1\u0301\u0327\u1e9e\u0130\u212a\u00df\u0131',
  '\u0627\u0644\u0639\u0631\u0628\u064a\u0629\u05d0\u05d1\u05d2',
  '\u3042\u3044\u3046\u4e2d\u6587\ud55c\uae00\u0e44\u0e17\u0e22',
  '\ud83d\ude00\ud83d\udc4d\ud83c\udde6\ud83c\uddff\ud83d\udc68\u200d\ud83d\udc69\ud83c\udffb',
  '\ud800\udc00\ud83d\ude00\udfff\ud800',
  '\uff10\uff11\uff12\uff21\uff41\uff0e\uff0f\uff1a\uff20',
];

function randomChars(r: Rng, len: number): string {
  const alpha = r.pick(ALPHABETS);
  // Iterate by UTF-16 unit so lone surrogates in the alphabet stay lone.
  let out = '';
  for (let i = 0; i < len; i += 1) out += alpha[r.int(alpha.length)]!;
  return out;
}

/** Edits a string in place of the attacker's choice: insert, delete, duplicate, replace, or splice in another payload. */
export function mutate(r: Rng, s: string): string {
  const n = r.range(1, 3);
  let out = s;
  for (let i = 0; i < n; i += 1) {
    const at = r.int(out.length + 1);
    switch (r.int(7)) {
      case 0:
        out = out.slice(0, at) + r.pick(CORPUS) + out.slice(at);
        break;
      case 1:
        out = out.slice(0, at) + out.slice(at + r.range(1, 8));
        break;
      case 2:
        out = out + out.slice(r.int(out.length + 1));
        break;
      case 3:
        out = out.slice(0, at) + String.fromCharCode(r.int(0x10000)) + out.slice(at + 1);
        break;
      case 4:
        out =
          out.slice(0, at) +
          r.pick(['\u0000', '\n', '\r', '\t', ' ', '%', '\\', '"', "'", '<', '>']) +
          out.slice(at);
        break;
      case 5:
        out = out.toUpperCase();
        break;
      default:
        out =
          out.slice(0, at) +
          r.pick(['.', '..', '/', '@', ':', '%00', '%2e', '\u3002']) +
          out.slice(at);
    }
  }
  return out;
}

const realistic = {
  email: (r: Rng) =>
    `${randomChars(r, r.range(1, 12))}@${randomChars(r, r.range(1, 8))}.${r.pick(['com', 'io', 'co.uk', 'x'])}`,
  uuid: (r: Rng) => {
    const h = (n: number) => Array.from({ length: n }, () => r.int(16).toString(16)).join('');
    return `${h(8)}-${h(4)}-${r.pick(['1', '4', '7', 'f'])}${h(3)}-${r.pick(['8', '9', 'a', 'b', '0'])}${h(3)}-${h(12)}`;
  },
  phone: (r: Rng) =>
    `${r.pick(['', '+', '00', '+91', '(+1) '])}${Array.from({ length: r.range(1, 18) }, () => r.int(10)).join('')}`,
  url: (r: Rng) =>
    `${r.pick(['https', 'http', 'ftp', 'HTTPS'])}://${r.pick(['example.com', 'a.b.co', '1.2.3.4', 'x'])}${r.pick(['', ':8080', ':0', ':65536'])}/${randomChars(r, r.range(0, 12))}`,
  date: (r: Rng) =>
    `${r.range(0, 9999)}-${r.range(0, 14)}-${r.range(0, 33)}T${r.range(0, 26)}:${r.range(0, 61)}:${r.range(0, 61)}${r.pick(['Z', '', '.123Z', '+05:30', '+99:99'])}`,
  token: (r: Rng) =>
    `${r.pick(['Bearer ', 'Basic ', 'sha256=', 'v1=', ''])}${randomChars(r, r.range(0, 80))}`,
};

/** A hostile or malformed string. */
export function text(r: Rng): string {
  const k = r.next();
  if (k < 0.22) return r.pick(CORPUS);
  if (k < 0.37) return mutate(r, r.pick(CORPUS));
  if (k < 0.5) return randomChars(r, r.chance(0.8) ? r.range(0, 24) : r.range(25, 600));
  if (k < 0.58) return redos(r);
  if (k < 0.64) {
    // Overlong: a unit repeated to 10 KB to 300 KB.
    const unit = r.pick(['a', '\u0000', '\u{1F600}', '<', 'ab\n', '{{x}}', '\u202e', '9']);
    return unit.repeat(r.chance(0.1) ? r.range(100_000, 300_000) : r.range(1000, 20_000));
  }
  if (k < 0.7) return text(r) + text(r);
  if (k < 0.78)
    return (
      realistic[r.pick(Object.keys(realistic) as Array<keyof typeof realistic>)] as (
        r: Rng,
      ) => string
    )(r);
  if (k < 0.84)
    return mutate(
      r,
      (
        realistic[r.pick(Object.keys(realistic) as Array<keyof typeof realistic>)] as (
          r: Rng,
        ) => string
      )(r),
    );
  return Array.from({ length: r.range(1, 3) }, () => r.pick(CORPUS)).join(
    r.pick(['', ' ', ',', '\n', '/']),
  );
}

// --- numbers ---------------------------------------------------------------------------------------------------------------------

const NUMBERS: readonly number[] = [
  NaN,
  Infinity,
  -Infinity,
  -0,
  0,
  1,
  -1,
  0.1 + 0.2,
  0.5,
  -0.5,
  1.5,
  1e-7,
  5e-324,
  1.7976931348623157e308,
  -1.7976931348623157e308,
  1e21,
  1e-21,
  2 ** 31 - 1,
  2 ** 31,
  -(2 ** 31),
  -(2 ** 31) - 1,
  2 ** 32 - 1,
  2 ** 32,
  2 ** 53 - 1,
  2 ** 53,
  2 ** 53 + 2,
  -(2 ** 53),
  2 ** 63,
  2 ** 64,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  Number.EPSILON,
  255,
  256,
  65535,
  65536,
  1000000,
  -1000000,
];
export function num(r: Rng): number {
  const k = r.next();
  if (k < 0.5) return r.pick(NUMBERS);
  if (k < 0.7) return r.range(-1000, 1000);
  if (k < 0.85) return (r.next() - 0.5) * 10 ** r.range(0, 30);
  return r.pick(NUMBERS) + r.pick([-1, 1, 0.5, 1e-9]);
}

// --- JSON-shaped values ----------------------------------------------------------------------------------------------------------

const KEYS: readonly string[] = [
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'valueOf',
  'hasOwnProperty',
  '__defineGetter__',
  '__lookupGetter__',
  'isAdmin',
  'role',
  'orgId',
  'id',
  '$ne',
  '$gt',
  '$where',
  '',
  ' ',
  '0',
  '-1',
  '1e3',
  'a.b',
  'a[b]',
  '../x',
  'a\u0000b',
  '\u202e',
  'constructor.prototype.polluted',
  '__proto__.polluted',
];

/** Sets a key as an OWN property even when it is `__proto__` (what `JSON.parse` does), so a body can carry it. */
export function setOwn(o: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

function nested(r: Rng): unknown {
  // A deep chain built iteratively (a recursive builder would fail in the fuzzer instead of the target).
  const depth = r.chance(0.2) ? r.range(2000, 30_000) : r.range(20, 1500);
  const kind = r.int(3);
  let v: unknown = r.pick<unknown>([null, 1, 'x', true, {}]);
  for (let i = 0; i < depth; i += 1) {
    if (kind === 0) v = [v];
    else if (kind === 1) v = { a: v };
    else v = i % 2 ? [v] : { k: v };
  }
  return v;
}

/** An arbitrary JSON-shaped value: any type, nesting, prototype-pollution keys, or a deep chain. (No self-reference: JSON cannot carry one.) */
export function json(r: Rng, depth = 0): unknown {
  const k = r.next();
  if (depth === 0 && k < 0.02) return nested(r);
  if (depth >= 3 || k < 0.5) return scalar(r);
  if (k < 0.75) return Array.from({ length: r.range(0, 5) }, () => json(r, depth + 1));
  const o: Record<string, unknown> = {};
  for (let i = r.range(0, 5); i > 0; i -= 1)
    setOwn(o, r.chance(0.6) ? r.pick(KEYS) : text(r).slice(0, 40), json(r, depth + 1));
  return o;
}

/** A leaf of any type a JSON body or a query string can carry, plus `undefined` (an absent field). */
export function scalar(r: Rng): unknown {
  switch (r.int(10)) {
    case 0:
      return null;
    case 1:
      return undefined;
    case 2:
      return r.chance(0.5);
    case 3:
      return num(r);
    default:
      return text(r);
  }
}

/** Any value at all. */
export function anything(r: Rng): unknown {
  return r.chance(0.55) ? text(r) : json(r);
}

/** A value of the wrong type for `like`: an array where a string was, a string where an object was, and so on. */
export function confuse(r: Rng, like: unknown): unknown {
  const choices: unknown[] = [
    null,
    undefined,
    text(r),
    num(r),
    r.chance(0.5),
    [like],
    [],
    {},
    { 0: like },
    { value: like },
    [text(r), text(r)],
  ];
  return r.pick(choices);
}

// --- inputs derived from a valid sample ------------------------------------------------------------------------------------------

function clone(v: unknown, depth = 0): unknown {
  if (depth > 12 || v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map((x) => clone(x, depth + 1));
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) setOwn(o, k, clone(x, depth + 1));
  return o;
}

function paths(
  v: unknown,
  prefix: Array<string | number>,
  out: Array<Array<string | number>>,
  depth = 0,
): void {
  out.push(prefix);
  if (depth > 8 || v === null || typeof v !== 'object') return;
  if (Array.isArray(v)) v.forEach((x, i) => paths(x, [...prefix, i], out, depth + 1));
  else for (const [k, x] of Object.entries(v)) paths(x, [...prefix, k], out, depth + 1);
}

/**
 * A copy of a valid value with one to three places damaged: a leaf replaced by hostile text, a number edge case or the wrong type, a
 * field dropped, or a pollution key added. A request body that is almost right reaches the checks past the first one.
 */
export function perturb(r: Rng, sample: unknown): unknown {
  let root = clone(sample);
  for (let n = r.range(1, 3); n > 0; n -= 1) {
    const all: Array<Array<string | number>> = [];
    paths(root, [], all);
    const at = r.pick(all);
    const action = r.next();
    let replacement: unknown;
    if (action < 0.35) replacement = text(r);
    else if (action < 0.5) replacement = num(r);
    else if (action < 0.7) replacement = confuse(r, undefined);
    else if (action < 0.8) replacement = json(r);
    else replacement = undefined;
    if (at.length === 0) {
      root = replacement === undefined ? clone(sample) : replacement;
      continue;
    }
    let parent = root as Record<string | number, unknown>;
    for (let i = 0; i < at.length - 1; i += 1)
      parent = parent[at[i]!] as Record<string | number, unknown>;
    const last = at[at.length - 1]!;
    if (replacement === undefined) {
      if (Array.isArray(parent)) parent.splice(last as number, 1);
      else delete parent[last];
    } else if (action >= 0.8 && !Array.isArray(parent) && r.chance(0.5)) {
      setOwn(parent as Record<string, unknown>, r.pick(KEYS), replacement); // add a hostile key next to the field
    } else parent[last] = replacement;
  }
  return root;
}
