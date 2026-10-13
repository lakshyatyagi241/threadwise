import { describe, expect, it } from 'vitest';
import {
  BlockedHostError,
  resolveSafeTarget,
} from '../../../src/infra/providers/channel-email/imap/host-guard';

describe('the IMAP/SMTP SSRF guard', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.9',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:a9fe:a9fe',
    '[::1]',
    'localhost',
  ])('refuses %s', async (host) => {
    await expect(resolveSafeTarget(host, false)).rejects.toBeInstanceOf(BlockedHostError);
  });

  it('refuses an empty host', async () => {
    await expect(resolveSafeTarget('  ', false)).rejects.toBeInstanceOf(BlockedHostError);
  });

  it('allows a public address literal and pins it with no server name', async () => {
    await expect(resolveSafeTarget('93.184.216.34', false)).resolves.toEqual({
      connectHost: '93.184.216.34',
      servername: undefined,
    });
  });

  it('lets private hosts through only when the platform allows it, keeping the name for the certificate', async () => {
    await expect(resolveSafeTarget('127.0.0.1', true)).resolves.toMatchObject({
      connectHost: '127.0.0.1',
    });
    await expect(resolveSafeTarget('localhost', true)).resolves.toEqual({
      connectHost: 'localhost',
      servername: 'localhost',
    });
  });
});
