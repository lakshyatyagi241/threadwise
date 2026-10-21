// Sheet3 #34: hostile payloads against the shared upload guards, plus a ratchet over every upload route.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { UploadPolicyService } from '../../../src/modules/auth/security/upload-policy.service';
import {
  servableMime,
  sniffMediaType,
} from '../../../src/infra/providers/chat-conversations/media/media-types';
import { isSafeSvg } from '../../../src/modules/chatbot-widget/svg-safe';
import { sniffImage as sniffBrand } from '../../../src/modules/platform-settings-branding-storage/brand-assets.service';
import { sniffImage as sniffLogo } from '../../../src/modules/platform-payment-gateways/image-sniff';
import { readZipEntry } from '../../../src/modules/ai-agents-training/file-extract';

const policy = new UploadPolicyService();
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const check = (
  filename: string,
  buffer: Buffer,
  allow: ('image' | 'media' | 'document')[] = ['image', 'document'],
) => policy.validate({ filename, buffer, allow, maxBytes: 1024 * 1024 });
const html = Buffer.from('<html><script>alert(1)</script></html>');
const pad = (n: number, tail: string) =>
  Buffer.concat([Buffer.from('a'.repeat(n)), Buffer.from(tail)]);

describe('UploadPolicyService: extension and content', () => {
  it.each([
    ['evil.html', html],
    ['evil.svg', html],
    ['x.php', html],
    ['x.png.php', PNG],
    ['x.phtml', PNG],
    ['x.png.html', PNG],
    ['x.js', html],
    ['x.exe', PNG],
    ['.htaccess', html],
    ['noext', PNG],
    ['x.png.', PNG],
    ['x.png ', Buffer.from('MZ')],
  ])('refuses %s', (name, buf) => expect(() => check(name, buf)).toThrow());
  it('refuses a png name with html bytes (extension spoof)', () =>
    expect(() => check('a.png', html)).toThrow());
  it('refuses a pdf named png and a png named pdf', () => {
    expect(() => check('a.png', Buffer.from('%PDF-1.4'))).toThrow();
    expect(() => check('a.pdf', PNG)).toThrow();
  });
  it('refuses empty and oversized', () => {
    expect(() => check('a.png', Buffer.alloc(0))).toThrow();
    expect(() =>
      policy.validate({
        filename: 'a.png',
        buffer: Buffer.concat([PNG, Buffer.alloc(2000)]),
        allow: ['image'],
        maxBytes: 100,
      }),
    ).toThrow();
  });
  it('allows a real png under the right name and kind only', () => {
    expect(check('a.png', PNG).mime).toBe('image/png');
    expect(() => check('a.png', PNG, ['document'])).toThrow();
  });
  it('stored name never carries client text (traversal, null byte, unicode)', () => {
    for (const n of [
      '../../etc/passwd.png',
      '/abs/x.png',
      'a\u0000.php.png',
      'a‮gnp.png',
      '..\\..\\x.png',
    ]) {
      const r = check(n, PNG);
      expect(r.storedName).toMatch(/^\d+_[0-9a-f]{24}\.png$/);
    }
  });
  it('refuses markup hidden in a text file even past the first 1 KB', () => {
    expect(() => check('n.txt', pad(10, '<script>x</script>'))).toThrow();
    expect(() => check('n.txt', pad(4000, '<script>x</script>'))).toThrow();
    expect(() => check('n.csv', pad(4000, '<svg onload=alert(1)>'))).toThrow();
  });
});

describe('sniffMediaType and servableMime (chat media)', () => {
  it('never reports html/svg/php as an image or document', () => {
    for (const b of [
      html,
      Buffer.from('<svg onload=alert(1)></svg>'),
      Buffer.from('<?php system($_GET[0]);'),
    ]) {
      expect(sniffMediaType(b, 'image/png')).toBeNull();
    }
  });
  it('markup after 1 KB in a text upload is refused', () => {
    expect(sniffMediaType(pad(4000, '<script>x</script>'), 'text/plain')).toBeNull();
  });
  it('never echoes an active content type', () => {
    for (const t of [
      'text/html',
      'image/svg+xml',
      'application/xhtml+xml',
      'text/javascript',
      'application/javascript',
    ])
      expect(servableMime(t, 'k/abc.bin')).toBe('application/octet-stream');
    expect(servableMime('text/html', 'k/abc.html')).toBe('application/octet-stream');
  });
});

describe('SVG', () => {
  const bad = [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"/>',
    '<svg><foreignObject><iframe src="x"/></foreignObject></svg>',
    '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
    '<svg><image href="http://evil.example/x.png"/></svg>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
    '<svg><style>@import url(http://evil)</style></svg>',
    '<svg><use xlink:href="http://evil/x.svg#a"/></svg>',
    '<html><svg/></html>',
  ];
  it.each(bad)('widget isSafeSvg refuses %s', (s) => expect(isSafeSvg(Buffer.from(s))).toBe(false));
  it('widget isSafeSvg accepts a plain svg', () =>
    expect(
      isSafeSvg(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'),
      ),
    ).toBe(true));
  // brand assets and invoice logo accept SVG: the shared sniffers must not pass active SVG (SEC-UPLOAD-1)
  it.each(bad.slice(0, 8))('brand and invoice-logo sniffers refuse active svg %s', (s) => {
    expect(sniffBrand(Buffer.from(s))).not.toBe('image/svg+xml');
    expect(sniffLogo(Buffer.from(s))).not.toBe('image/svg+xml');
  });
  it('brand and invoice-logo sniffers still accept a plain svg', () => {
    const ok = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
    );
    expect(sniffBrand(ok)).toBe('image/svg+xml');
    expect(sniffLogo(ok)).toBe('image/svg+xml');
  });
});

describe('zip bomb', () => {
  it('readZipEntry rejects an entry that inflates past its declared size', async () => {
    const data = Buffer.alloc(80 * 1024 * 1024);
    const raw = deflateRawSync(data);
    const name = Buffer.from('word/document.xml');
    const lie = 100; // declared size far below the real one
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    loc.writeUInt16LE(8, 8);
    loc.writeUInt32LE(raw.length, 18);
    loc.writeUInt32LE(lie, 22);
    loc.writeUInt16LE(name.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(raw.length, 20);
    cen.writeUInt32LE(lie, 24);
    cen.writeUInt16LE(name.length, 28);
    const body = Buffer.concat([loc, name, raw]);
    const dir = Buffer.concat([cen, name]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(dir.length, 12);
    eocd.writeUInt32LE(body.length, 16);
    const zip = Buffer.concat([body, dir, eocd]);
    let out: Buffer | null = null;
    let threw = false;
    try {
      out = await readZipEntry(zip, 'word/document.xml');
    } catch {
      threw = true;
    }
    expect(threw || (out !== null && out.length <= 64 * 1024 * 1024)).toBe(true);
  });
});

// ---- ratchet: every upload interceptor needs a server-side size cap and a reviewed entry in this manifest ----
const SRC = resolve(__dirname, '../../../src');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory()
      ? walk(p)
      : p.endsWith('.ts') && !p.endsWith('.spec.ts')
        ? [p]
        : [];
  });
/** file -> how its bytes are checked. A new upload route fails this test until a reviewer adds it here. */
const REVIEWED: Record<string, string> = {
  'modules/addons-extension-registry/platform-extensions.controller.ts':
    'super_admin; zip-reader bounds + CRC',
  'modules/message-templates/templates.controller.ts': 'UploadPolicyService',
  'modules/ai-agents-training/ai-training.controller.ts': 'file-extract (zip inflate cap)',
  'modules/whatsapp-devices-baileys/device-groups.controller.ts': 'sniff',
  'modules/channel-email/mail-outbound-attachments.controller.ts': 'sniff',
  'modules/admin-console-shell/workspace-settings.controller.ts': 'sniff',
  'modules/flow-builder-editor/flows.controller.ts': 'sniff',
  'modules/broadcasts/marketing-media.controller.ts': 'UploadPolicyService',
  'modules/calling-voice/calling.controller.ts': 'sniff',
  'modules/auth/controllers/account.controller.ts': 'UploadPolicyService',
  'modules/scheduled-queue-warmer/scheduled.controller.ts': 'UploadPolicyService',
  'modules/marketing-site-cms/operator-content.controller.ts': 'UploadPolicyService',
  'modules/chatbot-widget/widget-public.controller.ts': 'UploadPolicyService',
  'modules/chatbot-widget/flow-widget.controller.ts': 'UploadPolicyService / isSafeSvg',
  'modules/platform-payment-gateways/checkout.controller.ts': 'sniffImage',
  'modules/platform-payment-gateways/admin-billing.controller.ts': 'sniffImage',
  'modules/campaigns/wizard/wizard.controller.ts': 'CSV parse, size cap',
  'modules/crm/contact-import/contact-import.controller.ts': 'CSV parse, size cap',
  'modules/appointments-booking/booking-page-themes.controller.ts': 'sniff',
  'modules/developer-rest-api-v1/resources/messaging/v1-file-upload.ts': 'UploadPolicyService',
  'modules/developer-rest-api-v1/resources/automation/templates/templates.v1.controller.ts':
    'UploadPolicyService',
  'modules/team-inbox-conversations/inbox.controller.ts': 'UploadPolicyService',
  'modules/team-inbox-conversations/saved-replies/saved-replies-transfer.controller.ts':
    'CSV parse, size cap',
  'modules/platform-settings-branding-storage/settings.controller.ts': 'sniffImage',
  'modules/team-chat/team-chat.controller.ts': 'UploadPolicyService',
};
describe('ratchet: upload routes', () => {
  const sites = walk(SRC).flatMap((f) => {
    const t = readFileSync(f, 'utf8');
    return [...t.matchAll(/(?:File|Files|FileFields|AnyFiles)Interceptor\(/g)].map((m) => ({
      f: f.slice(SRC.length + 1),
      ctx: t.slice(m.index!, m.index! + 400),
    }));
  });
  it('finds the upload routes', () => expect(sites.length).toBeGreaterThan(20));
  it('every interceptor sets limits.fileSize', () => {
    const missing = sites.filter((s) => !/fileSize/.test(s.ctx)).map((s) => s.f);
    expect(missing).toEqual([]);
  });
  it('every file with an interceptor is in the reviewed manifest', () => {
    const unknown = [...new Set(sites.map((s) => s.f))].filter((f) => !(f in REVIEWED));
    expect(unknown, 'new upload route: review it, then add it to REVIEWED').toEqual([]);
  });
  it('the manifest has no stale entries', () => {
    const have = new Set(sites.map((s) => s.f));
    expect(Object.keys(REVIEWED).filter((f) => !have.has(f))).toEqual([]);
  });
});

describe('ratchet: shared policy and scanner', () => {
  const files = walk(SRC);
  const calls = files.flatMap((f) => {
    const t = readFileSync(f, 'utf8');
    return /\b(uploads|policy|upload)\.validate\(\{/.test(t) ? [f.slice(SRC.length + 1)] : [];
  });
  // header-upload.guard is synchronous (inline template header media): structure checks yes, antivirus scan not yet (open item)
  const SYNC_ALLOWED = [
    'modules/developer-rest-api-v1/resources/automation/templates/header-upload.guard.ts',
  ];
  it('services call validateScanned so the antivirus hook applies; plain validate only where listed', () => {
    expect(calls.filter((c) => !SYNC_ALLOWED.includes(c))).toEqual([]);
  });
  it('every route reviewed as UploadPolicyService has a service in its module that calls validateScanned', () => {
    const missing = Object.entries(REVIEWED)
      .filter(([, how]) => how.startsWith('UploadPolicyService'))
      .map(([f]) => f)
      .filter((f) => {
        const dir = join(SRC, f.split('/').slice(0, 2).join('/'));
        return !walk(dir).some((p) =>
          /validateScanned\(|ChatMediaStore|ChatMediaService|MediaIntake|scanUpload\(/.test(
            readFileSync(p, 'utf8'),
          ),
        );
      });
    expect(missing).toEqual([]);
  });
});
