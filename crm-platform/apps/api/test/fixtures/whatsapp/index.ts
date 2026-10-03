import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Recorded-shape fixtures for the WhatsApp Cloud channel. They were written from Meta's published webhook and Graph API payload
 * shapes (Cloud API reference: webhooks `messages`, `statuses`, error codes); no real account produced them. Nothing that uses them
 * proves behaviour against live Meta: it proves the code handles these shapes.
 */
const read = (dir: string, name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, dir, `${name}.json`), 'utf8'));

export const webhookFixture = (name: string) => read('webhooks', name) as Record<string, unknown>;
export const graphFixture = (name: string) => read('graph', name) as Record<string, unknown>;
export const graphError = (name: string) => read('graph', `error-${name}`) as { error: Record<string, unknown> };

/** The ids the fixtures use. */
export const FX = {
  phoneNumberId: '109876543210001',
  wabaId: '102345678901234',
  displayPhone: '15550001111',
  customer: '919876543210',
  accessToken: 'EAAGtestAccessTokenForFixtures0123456789',
  appSecret: 'fixture-app-secret-0123456789',
  appId: '4000000000001',
};
