import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DashFunnel } from '@crm/contracts';
import { Funnel } from './funnel';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'dashboards-analytics-charts.json'), 'utf8'),
) as Record<string, unknown>;
const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

const funnel = (over: Partial<DashFunnel> = {}): DashFunnel => ({
  stages: [],
  endToEnd: 0,
  contacts: { messaged: 31, delivered: 31, replied: 4, goalCompleted: 5 },
  activity: { inbound: 27, respondingContacts: 4, repliesPerContact: 6.8 },
  replyRate: 12.9,
  comparison: { previousReplyRate: 8.5, replyRatePp: 4.4 },
  ...over,
});

describe('Funnel (contacts)', () => {
  it('draws four stages with percent of contacts messaged, the activity line and the comparison', () => {
    const out = html(<Funnel funnel={funnel()} />);
    expect(out).toContain('Contacts messaged');
    expect(out).toContain('Delivered');
    expect(out).toContain('Replied');
    expect(out).toContain('12.9%');
    expect(out).toContain(
      '27 inbound messages · 4 responding contacts · 6.8 replies/responding contact',
    );
    expect(out).toContain('Compared with previous period');
    expect(out).toContain('+4.4pp');
    expect(out).toContain('Goal completed');
    expect(out).toContain('Goal completed: 5 contacts, 16.1% of contacts messaged');
    expect(out).toContain('Contacts whose flow finished');
    expect(out).toContain('16.1%');
    expect((out.match(/<li /g) ?? []).length).toBe(4);
  });

  it('shows a dash for replies per contact when nobody replied and hides the comparison without a previous window', () => {
    const out = html(
      <Funnel
        funnel={funnel({
          contacts: { messaged: 5, delivered: 5, replied: 0, goalCompleted: 0 },
          activity: { inbound: 0, respondingContacts: 0, repliesPerContact: null },
          replyRate: 0,
          comparison: null,
        })}
      />,
    );
    expect(out).toContain(
      '0 inbound messages · 0 responding contacts · - replies/responding contact',
    );
    expect(out).not.toContain('Compared with previous period');
    expect(out).toContain('Goal completed: 0 contacts, 0% of contacts messaged');
    expect((out.match(/<li /g) ?? []).length).toBe(4);
  });

  it('a drop uses the warning tone and zero is neutral', () => {
    const down = html(
      <Funnel funnel={funnel({ comparison: { previousReplyRate: 20, replyRatePp: -7.1 } })} />,
    );
    expect(down).toContain('text-warning');
    expect(down).toContain('-7.1pp');
    const flat = html(
      <Funnel funnel={funnel({ comparison: { previousReplyRate: 12.9, replyRatePp: 0 } })} />,
    );
    expect(flat).toContain('text-muted-foreground');
    expect(flat).toContain('–');
  });
});
