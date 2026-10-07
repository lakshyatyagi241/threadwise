import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WABA_GROUP_WEBHOOK_FIELDS, WABA_PLATFORM_WEBHOOK_FIELDS } from '@crm/contracts';
import { WebhookFieldList } from './waba-callback';

const messages = JSON.parse(
  readFileSync(
    join(process.cwd(), 'messages', 'en', 'platform-settings-branding-storage.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const render = (status: { subscribed: string[]; missing: string[] }) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <WebhookFieldList status={status} />
    </NextIntlClientProvider>,
  );

describe('the webhook field check list', () => {
  it('lists the four coexistence and the four Groups fields, the Groups ones tagged', () => {
    const out = render({ subscribed: [], missing: [...WABA_PLATFORM_WEBHOOK_FIELDS] });
    for (const f of WABA_PLATFORM_WEBHOOK_FIELDS) expect(out).toContain(f);
    expect(out.match(/waba-group-field-tag/g)).toHaveLength(WABA_GROUP_WEBHOOK_FIELDS.length);
    expect(out.match(/MISSING/g)).toHaveLength(8);
  });

  it('keeps the old fields untagged and ticks what is subscribed', () => {
    const out = render({
      subscribed: ['messages', 'smb_message_echoes', 'group_status_update'],
      missing: ['smb_app_state_sync', 'history', 'group_lifecycle_update'],
    });
    expect(out).toContain('✓ messages');
    expect(out).toContain('○ history');
    expect(out.match(/waba-group-field-tag/g)).toHaveLength(2);
    expect(out.match(/MISSING/g)).toHaveLength(3);
  });
});
