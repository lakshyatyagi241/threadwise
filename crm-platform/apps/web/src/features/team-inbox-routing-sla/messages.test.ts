import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANNEL_KINDS, ROUTING_STRATEGIES, AGENT_AVAILABILITY } from '@crm/contracts';

const load = (lang: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'messages', lang, 'team-inbox-routing-sla.json'), 'utf8'),
  ) as { 'team-inbox-routing-sla': Record<string, Record<string, unknown>> };

const keys = (o: unknown, prefix = ''): string[] =>
  o && typeof o === 'object'
    ? Object.entries(o).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
    : [prefix];

describe('team-inbox-routing-sla messages', () => {
  it('Arabic has exactly the keys English has', () => {
    expect(keys(load('ar')).sort()).toEqual(keys(load('en')).sort());
  });

  it('labels every channel, strategy and availability the API can send, in both languages', () => {
    for (const lang of ['en', 'ar']) {
      const m = load(lang)['team-inbox-routing-sla']!;
      for (const k of CHANNEL_KINDS) expect(m.channels![k], `${lang} channel ${k}`).toBeTruthy();
      const strategy = (m.rules as { strategy: Record<string, string> }).strategy;
      for (const s of ROUTING_STRATEGIES) expect(strategy[s], `${lang} strategy ${s}`).toBeTruthy();
      const availability = (m.form as { availability: Record<string, string> }).availability;
      for (const a of AGENT_AVAILABILITY) expect(availability[a], `${lang} ${a}`).toBeTruthy();
    }
  });
});
