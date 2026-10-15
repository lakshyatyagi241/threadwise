import { describe, expect, it } from 'vitest';
import { isBlockedAddress as shared } from '../../../src/infra/net/blocked-address';
import { isBlockedAddress as training } from '../../../src/infra/providers/ai-agents-training/blocked-address';
import { isBlockedAddress as bridge } from '../../../src/infra/providers/node-bridge-runtime/safe-fetch';
import { isNonPublicAddress as waba } from '../../../src/infra/providers/whatsapp-cloud-api-waba/provider-url-guard';

/**
 * SSRF conformance (security item 29). Four places decide whether an outbound request may connect to an address. They must agree: an
 * address one of them lets through is an address an attacker will pick. The same table is fed to all four.
 */
const MUST_BLOCK = [
  '0.0.0.0',
  '127.0.0.1',
  '127.255.255.254',
  '10.0.0.1',
  '100.64.0.1',
  '169.254.169.254',
  '172.16.0.1',
  '172.31.255.255',
  '192.0.0.1',
  '192.0.2.1',
  '192.168.1.1',
  '198.18.0.1',
  '198.51.100.1',
  '203.0.113.1',
  '224.0.0.1',
  '240.0.0.1',
  '255.255.255.255',
  '::',
  '::1',
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '::ffff:a9fe:a9fe',
  '::ffff:10.0.0.1',
  '::ffff:c0a8:0001',
  '64:ff9b::7f00:1',
  '64:ff9b::a9fe:a9fe',
  '2002:7f00:1::1',
  '2002:a9fe:a9fe::1',
  '2001:db8::1',
  'fc00::1',
  'fd00::1',
  'fe80::1',
  'fec0::1',
  'ff02::1',
];

const MUST_ALLOW = [
  '1.1.1.1',
  '8.8.8.8',
  '93.184.216.34',
  '172.15.0.1',
  '172.32.0.1',
  '2606:4700:4700::1111',
  '::ffff:8.8.8.8',
];

const RULES: Array<[string, (a: string) => boolean]> = [
  ['infra/net (shared rule)', shared],
  ['ai-agents-training', training],
  ['node-bridge safe-fetch', bridge],
  ['whatsapp-cloud-api provider-url-guard', waba],
];

describe.each(RULES)('SSRF address rule: %s', (_name, blocked) => {
  it.each(MUST_BLOCK)('blocks %s', (ip) => {
    expect(blocked(ip)).toBe(true);
  });
  it.each(MUST_ALLOW)('allows the public address %s', (ip) => {
    expect(blocked(ip)).toBe(false);
  });
  // The bridge guard judges ADDRESSES only: a name is resolved first and each answer is judged (its own spec pins this), so text that is
  // not an address is not its question.
  it.each(['not-an-ip', '', '127.1', '2130706433', '0x7f.0.0.1', 'localhost'])(
    'refuses text that is not a canonical address (%j)',
    (t) => {
      expect(blocked(t)).toBe(_name === 'node-bridge safe-fetch' ? false : true);
    },
  );
});
