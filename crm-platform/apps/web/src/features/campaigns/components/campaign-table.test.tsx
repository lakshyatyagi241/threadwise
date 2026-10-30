import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Campaign } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import { CampaignTable } from './campaign-table';

// only what the table reads; the rest of a campaign is not drawn here
const campaign = (name: string, recipients: number, sent: number): Campaign =>
  ({
    id: `00000000-0000-4000-8000-0000000000${recipients % 100}`,
    name,
    type: 'template',
    status: 'completed',
    wizard: false,
    templateName: 'welcome',
    scheduleType: 'now',
    sendDate: null,
    sendTime: null,
    counts: { recipients, sent, delivered: sent, read: 0, replies: 0, clicks: 0, failed: 0 },
  }) as unknown as Campaign;

function render(items: Campaign[]) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
      <CampaignTable
        items={items}
        picked={[]}
        busy={null}
        canControl
        canUpdate
        canDelete={false}
        canExport
        onSelect={noop}
        onSelectAll={noop}
        onCancel={noop}
        onResume={noop}
        onResend={noop}
        onDelete={noop}
        onExport={noop}
      />
    </NextIntlClientProvider>,
  );
}

describe('the campaigns list view', () => {
  it('shows a Recipients column between Status and Sent, with the audience of each campaign', () => {
    const out = render([campaign('Diwali', 1734, 1700), campaign('Test', 12, 12)]);
    const head = [...out.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((m) =>
      m[1]!.replace(/<[^>]+>/g, ''),
    );
    const labels = head.filter((h) => h !== '');
    expect(labels.slice(0, 4)).toEqual(['Campaign', 'Status', 'Recipients', 'Sent']);
    // the audience, apart from the sent count, with a thousands separator
    expect(out).toContain('>1,734<');
    expect(out).toContain('>1,700<');
    expect(out).toContain('>12<');
  });

  it('has a cell under every header (the Recipients cell does not shift the others)', () => {
    const out = render([campaign('Diwali', 1734, 1700)]);
    const heads = (out.match(/<th /g) ?? []).length;
    const cells = (out.split('<tbody')[1]!.match(/<td[ >]/g) ?? []).length;
    expect(cells).toBe(heads);
  });
});
