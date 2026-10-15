import { describe, expect, it } from 'vitest';
import { guardSsrf } from '../../../src/modules/flow-builder-editor/ssrf-guard';
import { targetUrlProblem } from '../../../src/modules/webhook-fanout/url-guard';
import { endpointProblem } from '../../../src/infra/providers/localization-translation/endpoint-guard';

/**
 * SSRF URL vectors (security item 29): the spellings an attacker uses for "this machine" and "the metadata service", fed to the guards
 * that take a URL. The URL parser turns most of them into one canonical host before a guard sees it, which is what these pin.
 */
const INTERNAL_URLS = [
  'https://127.0.0.1/',
  'https://2130706433/', // decimal
  'https://0x7f000001/', // hex
  'https://0177.0.0.1/', // octal
  'https://127.1/', // short form
  'https://[::1]/',
  'https://[::ffff:127.0.0.1]/',
  'https://[::ffff:7f00:1]/',
  'https://[::ffff:a9fe:a9fe]/', // metadata, hex-mapped
  'https://169.254.169.254/latest/meta-data/',
  'https://0xa9fea9fe/', // metadata, hex
  'https://[fd00::1]/',
  'https://[fe80::1]/',
  'https://10.0.0.5:8443/',
  'https://192.168.0.1/',
  'https://100.64.0.1/',
  'https://0.0.0.0/',
];

describe('webhook target shape (webhook-fanout url-guard)', () => {
  it.each(INTERNAL_URLS)('refuses %s', (u) => {
    expect(targetUrlProblem(u)).not.toBeNull();
  });
  it.each([
    'http://example.com/', // not https
    'ftp://example.com/',
    'file:///etc/passwd',
    'gopher://example.com/',
    'https://user:pw@example.com/', // credentials in the URL
    'https://localhost/',
    'https://app.local/',
    'https://svc.internal/',
    'https://printer.lan/',
    'not a url',
  ])('refuses %s', (u) => {
    expect(targetUrlProblem(u)).not.toBeNull();
  });
  it('accepts a normal public https URL', () => {
    expect(targetUrlProblem('https://hooks.example.com/in?x=1')).toBeNull();
  });
});

describe('flow webhook test guard (guardSsrf)', () => {
  const never = async () => {
    throw new Error('must not resolve');
  };
  it.each(INTERNAL_URLS.map((u) => u.replace('https:', 'http:')))(
    'refuses %s without a lookup',
    async (u) => {
      expect((await guardSsrf(u, never)).ok).toBe(false);
    },
  );
  it.each([
    'ftp://example.com/',
    'file:///etc/passwd',
    'gopher://x/',
    'javascript:alert(1)',
    'mailto:a@b.c',
  ])('refuses the scheme of %s', async (u) => {
    expect((await guardSsrf(u, never)).ok).toBe(false);
  });
  it('refuses a public-looking name that resolves to the metadata address', async () => {
    const v = await guardSsrf('https://169.254.169.254.nip.io/', async () => [
      { address: '169.254.169.254', family: 4 },
    ]);
    expect(v.ok).toBe(false);
  });
  it('refuses a name when ANY of its answers is internal (a mixed answer is a rebinding trick)', async () => {
    const v = await guardSsrf('https://mixed.example.com/', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ]);
    expect(v.ok).toBe(false);
  });
  it('refuses a name that does not resolve', async () => {
    expect((await guardSsrf('https://nx.example.com/', async () => [])).ok).toBe(false);
  });
  it('accepts a public name and pins the checked address', async () => {
    const v = await guardSsrf('https://ok.example.com/x', async () => [
      { address: '93.184.216.34', family: 4 },
    ]);
    expect(v).toMatchObject({ ok: true, address: '93.184.216.34', family: 4 });
  });
});

describe('translation server endpoint (endpoint-guard)', () => {
  it.each([
    'http://169.254.169.254/',
    'http://[::ffff:169.254.169.254]/',
    'http://metadata.google.internal/',
    'http://[fe80::1]/',
    'ftp://example.com/',
    'file:///etc/passwd',
    'http://user:pw@example.com/',
  ])('refuses %s', (u) => {
    expect(endpointProblem(u)).not.toBeNull();
  });
  it('lets a self-hosted server on this machine or a private network through, on purpose (the documented LibreTranslate default)', () => {
    expect(endpointProblem('http://localhost:5000')).toBeNull();
    expect(endpointProblem('http://10.0.0.8:5000')).toBeNull();
  });
});
