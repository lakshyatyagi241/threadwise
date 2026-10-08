import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  brandSlug,
  fill,
  generateWooPlugin,
} from '../../../src/modules/shopify-woocommerce/plugin/woo-plugin.generator';
import { buildZip } from '../../../src/modules/shopify-woocommerce/plugin/zip-writer';

/** Reads a zip back through its central directory, as an unzip tool would. */
function readZip(buf: Buffer): Map<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(-1);
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + csize);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    expect(data.length).toBe(usize);
    expect(crc32(data)).toBe(crc);
    out.set(name, Buffer.from(data));
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

const SETTINGS = {
  brandName: 'Acme Shop',
  webhookUrl:
    'https://crm.example.com/v2/woocommerce/webhook/s3cr3t_Secret-Value_0123456789abcdefghij',
  webhookSecret: 's3cr3t_Secret-Value_0123456789abcdefghij',
};

describe('brandSlug', () => {
  it.each([
    ['Acme Shop', 'acme-shop'],
    ['  Café  Déjà!! ', 'cafe-deja'],
    ['***', 'store'],
    ['', 'store'],
    ['A'.repeat(80), 'a'.repeat(40)],
  ])('%j -> %j', (name, slug) => expect(brandSlug(name)).toBe(slug));
});

describe('generateWooPlugin', () => {
  const out = generateWooPlugin(SETTINGS);
  const files = readZip(out.zip);

  it('names the archive and its files after the brand slug', () => {
    expect(out.filename).toBe('acme-shop-woocommerce.zip');
    expect([...files.keys()].sort()).toEqual([
      'acme-shop-woocommerce/acme-shop-woocommerce.php',
      'acme-shop-woocommerce/assets/checkout-capture.js',
      'acme-shop-woocommerce/readme.txt',
    ]);
  });

  it('bakes the address, the secret, the delay and the brand in', () => {
    const php = files.get('acme-shop-woocommerce/acme-shop-woocommerce.php')!.toString();
    expect(php).toContain(`'${SETTINGS.webhookUrl}'`);
    expect(php).toContain(`'${SETTINGS.webhookSecret}'`);
    expect(php).toContain('const DELAY_MINUTES = 30;');
    expect(php).toContain('Plugin Name: Acme Shop for WooCommerce');
    expect(php).toContain('final class acme_shop_Bridge');
  });

  it('leaves no unreplaced token in any file', () => {
    for (const [name, data] of files) expect(data.toString(), name).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it('keeps the secret out of the browser script and the readme', () => {
    for (const name of ['assets/checkout-capture.js', 'readme.txt'])
      expect(files.get(`acme-shop-woocommerce/${name}`)!.toString()).not.toContain(
        SETTINGS.webhookSecret,
      );
  });

  it('forwards the topics the receiver understands', () => {
    const php = files.get('acme-shop-woocommerce/acme-shop-woocommerce.php')!.toString();
    for (const topic of ['checkout.created', 'subscription.payment_failed', 'order.updated'])
      expect(php).toContain(`'${topic}'`);
    expect(php).toContain('X-WC-Webhook-Signature');
    expect(php).toContain("'sha256'");
    expect(php).toContain('300');
  });

  it('honours a custom delay and clamps absurd ones', () => {
    const delay = (m: number) =>
      readZip(generateWooPlugin({ ...SETTINGS, cartDelayMinutes: m }).zip)
        .get('acme-shop-woocommerce/acme-shop-woocommerce.php')!
        .toString()
        .match(/DELAY_MINUTES = (\d+);/)![1];
    expect(delay(45)).toBe('45');
    expect(delay(0)).toBe('5');
    expect(delay(99999)).toBe('1440');
    expect(delay(Number.NaN)).toBe('30');
  });

  it('escapes quotes and backslashes of a hostile brand name or secret', () => {
    const evil = generateWooPlugin({
      brandName: "Bob's */ ?> {{WEBHOOK_SECRET_PHP}} \\ Shop",
      webhookUrl: "https://x.test/a'b",
      webhookSecret: "se'cret\\",
    });
    const php = readZip(evil.zip)
      .get(`${evil.filename.replace('.zip', '')}/${evil.filename.replace('.zip', '.php')}`)!
      .toString();
    expect(php).toContain("'se\\'cret\\\\'");
    expect(php).toContain("'https://x.test/a\\'b'");
    expect(php).not.toContain('*/ ?>');
    expect(evil.filename).toBe('bob-s-webhook-secret-php-shop-woocommerce.zip');
  });

  it('passes php -l when php is installed', () => {
    const probe = spawnSync('php', ['-v']);
    if (probe.error || probe.status !== 0) return; // no php here: the CI image checks it
    const dir = mkdtempSync(join(tmpdir(), 'woo-plugin-'));
    try {
      const evil = generateWooPlugin({ ...SETTINGS, brandName: "Bob's 9 Shop" });
      for (const z of [out, evil]) {
        for (const [name, data] of readZip(z.zip)) {
          if (!name.endsWith('.php')) continue;
          const file = join(dir, 'plugin.php');
          writeFileSync(file, data);
          const lint = spawnSync('php', ['-l', file], { encoding: 'utf8' });
          expect(lint.stdout + lint.stderr, name).toContain('No syntax errors');
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fill', () => {
  it('replaces in one pass and refuses an unknown token', () => {
    expect(fill('{{A}}-{{A}}', { A: '{{B}}' })).toBe('{{B}}-{{B}}');
    expect(() => fill('{{NOPE}}', {})).toThrow(/NOPE/);
  });
});

describe('buildZip', () => {
  it('round-trips files, including empty and non-ASCII names', () => {
    const entries = [
      { name: 'a/empty.txt', data: Buffer.alloc(0) },
      { name: 'ü/data.bin', data: Buffer.from([1, 2, 3, 4]) },
      { name: 'big.txt', data: Buffer.from('x'.repeat(10_000)) },
    ];
    const back = readZip(buildZip(entries));
    expect([...back.keys()]).toEqual(entries.map((e) => e.name));
    for (const e of entries) expect(back.get(e.name)!.equals(e.data)).toBe(true);
  });

  it('is deterministic', () => {
    const e = [{ name: 'a.txt', data: Buffer.from('hello hello hello') }];
    expect(buildZip(e).equals(buildZip(e))).toBe(true);
  });
});
