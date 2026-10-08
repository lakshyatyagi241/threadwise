import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEBHOOK_EVENTS } from '@crm/contracts';

const load = (lang: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'messages', lang, 'outbound-webhooks.json'), 'utf8'),
  ) as { 'outbound-webhooks': Record<string, Record<string, unknown>> };

const keys = (o: unknown, prefix = ''): string[] =>
  o && typeof o === 'object'
    ? Object.entries(o).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
    : [prefix];

describe('outbound-webhooks messages', () => {
  it('Arabic has exactly the keys English has', () => {
    expect(keys(load('ar')).sort()).toEqual(keys(load('en')).sort());
  });
  it('has a label for every event the API can send, in both languages', () => {
    for (const lang of ['en', 'ar'])
      for (const e of WEBHOOK_EVENTS)
        expect(load(lang)['outbound-webhooks']!.events![e], `${lang} ${e}`).toBeTruthy();
  });
});
