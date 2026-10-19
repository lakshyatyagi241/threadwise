import { BlockList, isIP } from 'node:net';
import { checkProviderBaseUrl } from '@crm/contracts';
import { Rng, URL_CORPUS, mutate, text } from '../gen';
import { Violation, type Target } from '../engine';
import { isBlockedAddress } from '../../../src/infra/net/blocked-address';
import {
  isPrivateAddress as fanoutIsPrivate,
  targetUrlProblem,
} from '../../../src/modules/webhook-fanout/url-guard';
import { isPrivateAddress as guardedHttpIsPrivate } from '../../../src/infra/net/guarded-http';
import {
  isNonPublicAddress,
  assertPublicUrl,
  UnsafeProviderUrlError,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/provider-url-guard';
import {
  isBlockedAddress as safeFetchBlocked,
  resolveMime,
  extensionFor,
} from '../../../src/infra/providers/node-bridge-runtime/safe-fetch';
import { isPublicIp, guardSsrf } from '../../../src/modules/flow-builder-editor/ssrf-guard';
import { endpointProblem } from '../../../src/infra/providers/localization-translation/endpoint-guard';
import { mediaUrlProblem } from '../../../src/modules/broadcasts/template-guards';
import {
  assertAllowedUrl,
  guardedLookup,
  isPublicAddress,
  META_MEDIA_HOST_SUFFIXES,
  type HostPolicy,
} from '../../../src/infra/providers/whatsapp/media/media-url-guard';
import { MediaFetchError } from '../../../src/infra/providers/whatsapp/media/media-fetch-error';
import {
  BlockedHostError,
  resolveSafeTarget,
} from '../../../src/infra/providers/channel-email/imap/host-guard';

/**
 * Address and URL guards. Nothing here touches the network: DNS is a stub that answers with hostile addresses, and `resolveSafeTarget` is
 * only given IP literals.
 *
 * The oracle is written separately from `blocked-address.ts`: IPv4 ranges go through Node's own `BlockList`, IPv6 is expanded to eight
 * groups from the canonical text the WHATWG URL parser prints. So the check is "do the two agree on every spelling", not "does the code
 * agree with itself".
 */

// --- oracle ----------------------------------------------------------------------------------------------------------------------

const v4List = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  v4List.addSubnet(net, bits, 'ipv4');
const v6List = new BlockList();
for (const [net, bits] of [
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['100::', 64],
] as const)
  v6List.addSubnet(net, bits, 'ipv6');

const v4Of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** Whether an address must not be connected to, by the oracle. Not an address at all: blocked. */
export function oracleBlocked(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return v4List.check(address, 'ipv4');
  if (kind !== 6) return true;
  let canon: string;
  try {
    canon = new URL(`http://[${address.split('%')[0]}]/`).hostname.slice(1, -1);
  } catch {
    return true;
  }
  const [head = '', tail = ''] = canon.split('::');
  const hs = head ? head.split(':') : [];
  const ts = canon.includes('::') && tail ? tail.split(':') : [];
  const g = [
    ...hs,
    ...Array<string>(canon.includes('::') ? 8 - hs.length - ts.length : 0).fill('0'),
    ...ts,
  ].map((x) => parseInt(x, 16));
  if (g.length !== 8 || g.some((x) => Number.isNaN(x))) return true;
  const zeros = (a: number, b: number) => g.slice(a, b).every((x) => x === 0);
  if (zeros(0, 6)) return true; // ::, ::1 and the deprecated ::/96 compatible form
  if (zeros(0, 5) && g[5] === 0xffff) return v4List.check(v4Of(g[6]!, g[7]!), 'ipv4'); // mapped
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6))
    return v4List.check(v4Of(g[6]!, g[7]!), 'ipv4'); // NAT64
  if (g[0] === 0x2002) return v4List.check(v4Of(g[1]!, g[2]!), 'ipv4'); // 6to4
  return v6List.check(canon, 'ipv6');
}

// --- generators ------------------------------------------------------------------------------------------------------------------

const OCT = [
  0, 1, 2, 9, 10, 11, 15, 16, 31, 32, 63, 64, 99, 100, 112, 126, 127, 128, 168, 169, 171, 172, 173,
  191, 192, 193, 198, 199, 203, 223, 224, 239, 240, 254, 255,
];
const oct = (r: Rng) => (r.chance(0.8) ? r.pick(OCT) : r.int(256));
const GROUPS = [
  0, 0, 0, 0, 1, 0xffff, 0x7f00, 0x7f01, 0xa9fe, 0x0a00, 0xc0a8, 0xac10, 0x6440, 0x64, 0xff9b,
  0x2002, 0x2001, 0xdb8, 0xfc00, 0xfd00, 0xfe80, 0xfec0, 0xff00, 0xff02, 0x100, 0x5db8, 0x2606,
  0x4700,
];

function v4Text(r: Rng): string {
  const parts = [oct(r), oct(r), oct(r), oct(r)];
  switch (r.int(8)) {
    case 0: // decimal and hex integer forms (isIP refuses them; URL parsing turns them into dotted)
      return String(((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!);
    case 1:
      return `0x${parts.map((p) => p.toString(16).padStart(2, '0')).join('')}`;
    case 2:
      return parts.map((p) => '0' + p.toString(8)).join('.');
    case 3:
      return `${parts[0]}.${(parts[1]! << 16) + (parts[2]! << 8) + parts[3]!}`;
    case 4:
      return parts.map((p) => String(p).padStart(r.range(1, 3), '0')).join('.');
    default:
      return parts.join('.');
  }
}

function v6Text(r: Rng): string {
  const g: number[] = Array.from({ length: 8 }, () => (r.chance(0.5) ? 0 : r.pick(GROUPS)));
  switch (r.int(6)) {
    case 0: // mapped
      g.fill(0, 0, 5);
      g[5] = 0xffff;
      g[6] = (oct(r) << 8) | oct(r);
      g[7] = (oct(r) << 8) | oct(r);
      break;
    case 1: // NAT64
      g.fill(0, 0, 8);
      g[0] = 0x64;
      g[1] = 0xff9b;
      g[6] = (oct(r) << 8) | oct(r);
      g[7] = (oct(r) << 8) | oct(r);
      break;
    case 2: // 6to4
      g[0] = 0x2002;
      g[1] = (oct(r) << 8) | oct(r);
      g[2] = (oct(r) << 8) | oct(r);
      break;
    case 3: // prefix ranges
      g[0] = r.pick([
        0xfc00, 0xfd12, 0xfe80, 0xfebf, 0xfec0, 0xfeff, 0xff02, 0x2001, 0x100, 0x2606,
      ]);
      if (r.chance(0.4)) g[1] = r.pick([0, 0xdb8, 1, 0x1db8]);
      break;
    default:
  }
  const hex = (n: number) =>
    r.chance(0.2) ? n.toString(16).toUpperCase().padStart(4, '0') : n.toString(16);
  let out: string;
  if (r.chance(0.6)) {
    // compress the longest zero run
    let best = -1;
    let bestLen = 0;
    for (let i = 0; i < 8; i += 1) {
      let j = i;
      while (j < 8 && g[j] === 0) j += 1;
      if (j - i > bestLen) {
        best = i;
        bestLen = j - i;
      }
    }
    out =
      bestLen >= 2
        ? `${g.slice(0, best).map(hex).join(':')}::${g
            .slice(best + bestLen)
            .map(hex)
            .join(':')}`
        : g.map(hex).join(':');
  } else out = g.map(hex).join(':');
  if (r.chance(0.2) && !out.endsWith('::')) {
    const parts = out.split(':');
    if (parts.length >= 2 && parts.length <= 7)
      out = `${parts.slice(0, -2).join(':')}:${oct(r)}.${oct(r)}.${oct(r)}.${oct(r)}`;
  }
  if (r.chance(0.05)) out += `%${r.pick(['eth0', '1', '', '25eth0'])}`;
  return out;
}

/** The text of an address in some spelling, or sometimes not an address at all. */
export function ipText(r: Rng): string {
  const k = r.next();
  if (k < 0.45) return v4Text(r);
  if (k < 0.93) return v6Text(r);
  return text(r);
}

const HOSTS = [
  'example.com',
  'a.b.co',
  'graph.facebook.com',
  'lookaside.fbsbx.com',
  'x.fbcdn.net',
  'localhost',
  'LOCALHOST',
  'localhost.',
  'localhost..',
  'metadata',
  'metadata.google.internal',
  'metadata.google.internal.',
  'METADATA.GOOGLE.INTERNAL',
  'a.internal',
  'a.internal.',
  'x.local',
  'x.local.',
  'x.localhost',
  'x.test',
  'x.example',
  'x.invalid',
  'x.lan',
  'x.home.arpa',
  'x.svc',
  'x.cluster.local',
  'x.corp',
  'x.localdomain',
  'internal',
  'local',
  'a',
  'a.b',
  'xn--80ak6aa92e.com',
  '1.1.1.1.nip.io',
  '\uff4c\uff4f\uff43\uff41\uff4c\uff48\uff4f\uff53\uff54',
  'localhost\u3002',
  'local\u200bhost',
  '%6c%6f%63%61%6c%68%6f%73%74',
  'a%2einternal',
  'a\u3002internal',
  'a.internal\u3002',
  '\u2460\u2467.0.0.1',
];

function hostText(r: Rng): string {
  const k = r.next();
  if (k < 0.3) return v4Text(r);
  if (k < 0.5) return `[${v6Text(r)}]`;
  if (k < 0.58) return v6Text(r); // unbracketed IPv6 in a URL (invalid)
  if (k < 0.92) {
    const h = r.pick(HOSTS);
    return r.chance(0.2) ? mutate(r, h) : h;
  }
  return text(r).slice(0, 80);
}

/** A URL: a known-bad one, a damaged one, or one built from a scheme, credentials, a host in some spelling, a port and a path. */
export function urlText(r: Rng): string {
  const k = r.next();
  if (k < 0.2) return r.pick(URL_CORPUS);
  if (k < 0.35) return mutate(r, r.pick(URL_CORPUS));
  if (k < 0.95) {
    const scheme = r.pick([
      'https',
      'https',
      'https',
      'http',
      'HTTPS',
      'ftp',
      'file',
      'javascript',
      'gopher',
      'ws',
      'data',
      '',
    ]);
    const cred = r.chance(0.12) ? r.pick(['u@', 'u:p@', ':@', '@']) : '';
    const port = r.chance(0.2)
      ? r.pick([':443', ':80', ':0', ':65535', ':65536', ':8443', ':', ':abc', ':00443'])
      : '';
    const path = r.chance(0.5)
      ? r.pick(['/', '/x', '/%2e%2e/', '?q=1', '#f', '/\\x', '/\u0000'])
      : '';
    const sep = r.chance(0.9) ? '://' : r.pick([':/', ':', ':///', ':\\\\']);
    return `${scheme}${sep}${cred}${hostText(r)}${port}${path}`;
  }
  return text(r);
}

// --- accept checks ---------------------------------------------------------------------------------------------------------------

function parts(raw: string): { url: URL; host: string } | null {
  try {
    const url = new URL(raw);
    return { url, host: url.hostname.toLowerCase().replace(/^\[|\]$/g, '') };
  } catch {
    return null;
  }
}

const bare = (h: string) => h.replace(/\.+$/, '');
const endsWithAny = (h: string, suffixes: readonly string[]) =>
  suffixes.some((s) => h === s.slice(1) || h.endsWith(s));

/** After a guard accepted `raw`, the host must be neither a blocked address nor (when the guard names them) an internal name. */
function checkAccepted(
  who: string,
  raw: string,
  o: {
    schemes: string[];
    internal?: readonly string[];
    metadata?: boolean;
    blockedIp?: boolean;
    creds?: boolean;
    trailingDot?: boolean;
  },
): void {
  const p = parts(raw);
  if (!p) throw new Violation(`${who} accepted a string the URL parser rejects`);
  if (!o.schemes.includes(p.url.protocol))
    throw new Violation(`${who} accepted the scheme ${p.url.protocol}`);
  if (o.creds !== false && (p.url.username || p.url.password))
    throw new Violation(`${who} accepted credentials in the URL`);
  if (isIP(p.host) !== 0) {
    if (o.blockedIp !== false && oracleBlocked(p.host))
      throw new Violation(`${who} accepted the blocked address ${p.host}`);
    return;
  }
  // A guard that is followed by a DNS check (the webhook target) is judged on the name as written; the others on the name as resolved.
  const name = o.trailingDot === false ? p.host : bare(p.host);
  if (
    o.internal &&
    (name === 'localhost' ||
      (o.trailingDot === false
        ? o.internal.some((x) => name.endsWith(x))
        : endsWithAny(name, o.internal)))
  )
    throw new Violation(`${who} accepted the internal name ${p.host}`);
  if (o.metadata && (name === 'metadata' || name === 'metadata.google.internal'))
    throw new Violation(`${who} accepted the metadata host ${p.host}`);
}

const FAN_OUT_INTERNAL = [
  '.local',
  '.internal',
  '.localhost',
  '.test',
  '.lan',
  '.home.arpa',
] as const;
const BASE_INTERNAL = [
  '.local',
  '.localhost',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.intranet',
  '.private',
  '.test',
  '.example',
  '.invalid',
  '.home.arpa',
  '.svc',
] as const;

// --- DNS stub --------------------------------------------------------------------------------------------------------------------

/** What the stub resolver says for a name: a fixed pseudo-random list of addresses in odd spellings, or nothing, or an error. */
function stubAnswer(host: string): string[] | null {
  const r = Rng.for(7, `dns:${host}`, 0);
  if (r.chance(0.08)) return null;
  const n = r.chance(0.05) ? 0 : r.range(1, 3);
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = r.chance(0.5) ? r.pick(['93.184.216.34', '2606:4700::1111', '8.8.8.8']) : ipText(r);
    if (isIP(a) !== 0) out.push(a);
  }
  return out;
}

const resolver = async (host: string): Promise<Array<{ address: string; family: number }>> => {
  const a = stubAnswer(host);
  if (a === null) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return a.map((address) => ({ address, family: isIP(address) }));
};

// --- targets ---------------------------------------------------------------------------------------------------------------------

const policy: HostPolicy = {
  hosts: ['graph.facebook.com', ...META_MEDIA_HOST_SUFFIXES],
  loopbackHost: null,
};

export function netTargets(): Target[] {
  const t: Target[] = [];

  t.push({
    name: 'addr:blocked-address-rules',
    group: 'net',
    weight: 60,
    gen: (r) => ipText(r),
    run: (input) => {
      const a = input as string;
      const want = oracleBlocked(a);
      const checks: Array<[string, boolean]> = [
        ['isBlockedAddress', isBlockedAddress(a)],
        ['webhook-fanout isPrivateAddress', fanoutIsPrivate(a)],
        ['guarded-http isPrivateAddress', guardedHttpIsPrivate(a)],
        ['provider isNonPublicAddress', isNonPublicAddress(a)],
        ['flow-builder isPublicIp (inverse)', !isPublicIp(a)],
        ['media isPublicAddress (inverse)', !isPublicAddress(a)],
        ['safe-fetch isBlockedAddress', isIP(a.toLowerCase()) !== 0 ? safeFetchBlocked(a) : want],
      ];
      for (const [who, got] of checks) {
        if (got !== want) throw new Violation(`${who}("${a}") = ${got}, oracle says ${want}`);
      }
    },
  });

  t.push({
    name: 'url:webhook-target-shape',
    group: 'net',
    weight: 25,
    gen: urlText,
    run: (input) => {
      if (targetUrlProblem(input as string) === null)
        checkAccepted('targetUrlProblem', input as string, {
          schemes: ['https:'],
          internal: FAN_OUT_INTERNAL,
          trailingDot: false,
        });
    },
  });
  t.push({
    name: 'url:media-url-shape',
    group: 'net',
    weight: 25,
    gen: urlText,
    run: (input) => {
      if (mediaUrlProblem(input as string) === null)
        // Meta fetches this address, not the platform: only a literal address that Meta cannot reach is checked, not names.
        checkAccepted('mediaUrlProblem', input as string, { schemes: ['https:'], creds: false });
    },
  });
  t.push({
    name: 'url:translation-endpoint',
    group: 'net',
    weight: 25,
    gen: urlText,
    run: (input) => {
      if (endpointProblem(input as string) !== null) return;
      const raw = input as string;
      checkAccepted('endpointProblem', raw, {
        schemes: ['http:', 'https:'],
        metadata: true,
        blockedIp: false,
      });
      // Loopback and private are allowed on purpose; link-local (the metadata range) is not.
      const p = parts(raw)!;
      if (
        isIP(p.host) !== 0 &&
        oracleBlocked(p.host) &&
        /^(169\.254\.|fe[89ab]|::ffff:a9fe|64:ff9b::a9fe|2002:a9fe)/i.test(p.host)
      )
        throw new Violation(`endpointProblem accepted the link-local address ${p.host}`);
    },
  });
  t.push({
    name: 'url:provider-base-url',
    group: 'net',
    weight: 25,
    gen: urlText,
    run: (input) => {
      const v = checkProviderBaseUrl(input as string);
      if (v.ok)
        checkAccepted('checkProviderBaseUrl', input as string, {
          schemes: ['https:'],
          internal: BASE_INTERNAL,
          creds: true,
        });
    },
  });
  t.push({
    name: 'url:provider-url-dns',
    group: 'net',
    weight: 20,
    gen: urlText,
    allow: (e) => e instanceof UnsafeProviderUrlError,
    run: async (input) => {
      const raw = input as string;
      await assertPublicUrl(raw, {
        resolve: async (h) => (await resolver(h)).map((a) => a.address),
      });
      const p = parts(raw.trim());
      if (!p) throw new Violation('assertPublicUrl accepted a string the URL parser rejects');
      const answers = stubAnswer(p.host);
      if (!answers || answers.length === 0 || answers.some(oracleBlocked))
        throw new Violation(
          `assertPublicUrl accepted a host whose answers are ${JSON.stringify(answers)}`,
        );
    },
  });
  t.push({
    name: 'url:flow-builder-ssrf-guard',
    group: 'net',
    weight: 25,
    gen: urlText,
    run: async (input) => {
      const v = await guardSsrf(input as string, resolver);
      if (!v.ok) return;
      // The metadata names are refused as a courtesy; the control is the resolved address, checked below.
      checkAccepted('guardSsrf', input as string, { schemes: ['http:', 'https:'], creds: false });
      if (oracleBlocked(v.address))
        throw new Violation(`guardSsrf returned the blocked connect address ${v.address}`);
      if (isIP(v.address) === 0)
        throw new Violation(`guardSsrf returned ${v.address}, not an address`);
    },
  });
  t.push({
    name: 'url:media-download-host-policy',
    group: 'net',
    weight: 20,
    gen: urlText,
    allow: (e) => e instanceof MediaFetchError,
    run: (input) => {
      const url = assertAllowedUrl(input as string, policy);
      const p = parts(url.href)!;
      if (url.protocol !== 'https:')
        throw new Violation('assertAllowedUrl accepted a non-https url');
      if (url.username || url.password)
        throw new Violation('assertAllowedUrl accepted credentials');
      if (url.port !== '' && url.port !== '443')
        throw new Violation(`assertAllowedUrl accepted the port ${url.port}`);
      if (isIP(p.host) !== 0)
        throw new Violation(`assertAllowedUrl accepted the address literal ${p.host}`);
      if (
        !endsWithAny(
          p.host,
          policy.hosts.map((h) => (h.startsWith('.') ? h : `.${h}`)),
        )
      )
        throw new Violation(`assertAllowedUrl accepted the host ${p.host}, outside the policy`);
    },
  });
  t.push({
    name: 'url:media-guarded-lookup',
    group: 'net',
    weight: 15,
    gen: (r) => r.int(1 << 30),
    run: async (n) => {
      const answers = stubAnswer(`h${n as number}`) ?? [];
      const lookup = guardedLookup(policy, (_h, cb) =>
        cb(
          null,
          answers.map((address) => ({ address, family: isIP(address) })),
        ),
      );
      const calls: Array<{ err: unknown; res: unknown }> = [];
      await new Promise<void>((done) => {
        lookup(`h${n as number}`, { all: true }, (err, res) => {
          calls.push({ err, res });
          done();
        });
      });
      const ok = calls[0]!.err === null || calls[0]!.err === undefined;
      const allPublic = answers.length > 0 && !answers.some(oracleBlocked);
      if (ok && !allPublic)
        throw new Violation(`guardedLookup let ${JSON.stringify(answers)} through`);
      if (calls.length !== 1)
        throw new Violation(`guardedLookup called back ${calls.length} times`);
    },
  });
  t.push({
    name: 'url:imap-host-literal',
    group: 'net',
    weight: 10,
    gen: (r) => {
      const a = ipText(r);
      return isIP(a.split('%')[0]!) !== 0 || r.chance(0.2)
        ? r.chance(0.2)
          ? `[${a}]`
          : a
        : '10.0.0.1';
    },
    allow: (e) => e instanceof BlockedHostError,
    run: async (input) => {
      const name = (input as string).trim().replace(/^\[|\]$/g, '');
      const target = await resolveSafeTarget(input as string, false);
      if (isIP(name) !== 0 && oracleBlocked(name))
        throw new Violation(
          `resolveSafeTarget connects to the blocked address ${name} (${target.connectHost})`,
        );
    },
  });
  t.push({
    name: 'mime:safe-fetch-resolve',
    group: 'net',
    weight: 5,
    gen: (r) => [text(r), urlText(r)],
    run: (input) => {
      const [ct, url] = input as [string, string];
      const m = resolveMime(ct, url);
      const e = extensionFor(m, url);
      if (typeof m !== 'string' || typeof e !== 'string')
        throw new Violation('resolveMime/extensionFor did not return strings');
    },
  });
  return t;
}
