import { describe, expect, it } from 'vitest';
import { isBlockedAddress as shared } from '../../../src/infra/net/blocked-address';
import { isBlockedAddress as training } from '../../../src/infra/providers/ai-agents-training/blocked-address';
import { isBlockedAddress as safeFetch } from '../../../src/infra/providers/node-bridge-runtime/safe-fetch';
import { isNonPublicAddress as waba } from '../../../src/infra/providers/whatsapp-cloud-api-waba/provider-url-guard';
import { isPublicAddress as media } from '../../../src/infra/providers/whatsapp/media/media-url-guard';
import { isPublicIp as flowTest } from '../../../src/modules/flow-builder-editor/ssrf-guard';
import { isPrivateAddress as fanout } from '../../../src/modules/webhook-fanout/url-guard';

/** Every address spelling that must never be connected to. One list, run against every guard's address rule. */
const MUST_BLOCK = [
  '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
  '169.254.169.254', '100.64.0.1', '100.127.255.255', '192.0.0.1', '192.0.2.1', '198.18.0.1',
  '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
  '::', '::1', 'fe80::1', 'fc00::1', 'fd00:ec2::254', 'ff02::1',
  '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:10.0.0.1', '::ffff:c0a8:1',
  '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2002:a9fe:a9fe::', '::127.0.0.1',
  '2001:0:4136:e378:8000:63bf:3fff:fdd2', 'not-an-address',
];
const MUST_ALLOW = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8'];

const guards: Record<string, (a: string) => boolean> = {
  'infra/net (shared)': shared,
  'ai-agents-training': training,
  'node-bridge safe-fetch': safeFetch,
  'waba provider-url-guard': waba,
  'whatsapp media': (a) => !media(a),
  'flow-builder ssrf-guard': (a) => !flowTest(a),
  'webhook-fanout url-guard': fanout,
};

describe.each(Object.entries(guards))('address rule: %s', (_name, blocked) => {
  it.each(MUST_BLOCK)('blocks %s', (a) => expect(blocked(a)).toBe(true));
  it.each(MUST_ALLOW)('allows %s', (a) => expect(blocked(a)).toBe(false));
});
