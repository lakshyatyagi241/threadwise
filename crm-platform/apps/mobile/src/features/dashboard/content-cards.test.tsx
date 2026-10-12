import { screen } from '@testing-library/react-native';
import { initI18n } from '@/lib/i18n';
import { emptyWidgets, summary, throughput, widgets } from '@/test/dashboard-fixtures';
import { renderApp } from '@/test/render';
import { CampaignsCard, TemplatesCard } from './campaign-cards';
import { DevicesCard, InstagramBand, IntegrationsCard } from './channel-cards';
import { FunnelCard } from './funnel-card';
import { PipelineCard } from './pipeline-card';
import { ActivityCard, FlowsCard, InboxCard } from './team-cards';
import { ThroughputPanel } from './throughput-panel';

const NOW = new Date('2026-10-10T22:00:00.000Z');

beforeAll(async () => {
  await initI18n('en');
});

describe('CampaignsCard', () => {
  it('lists the latest campaigns with status, progress and how many were delivered', async () => {
    await renderApp(<CampaignsCard data={widgets.campaigns} />);
    expect(screen.getByText('2 running - 1 scheduled - 1 paused')).toBeTruthy();
    expect(screen.getByText('9 in all')).toBeTruthy();
    expect(screen.getByText('Diwali offer')).toBeTruthy();
    expect(screen.getByText('Sending')).toBeTruthy();
    expect(screen.getByText('MARKETING - diwali_offer_v2')).toBeTruthy();
    expect(screen.getByText('300 / 500 delivered')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
  });

  it('names an unnamed campaign and shows an unknown status as it came', async () => {
    await renderApp(<CampaignsCard data={widgets.campaigns} />);
    expect(screen.getByText('Untitled campaign')).toBeTruthy();
    expect(screen.getByText('mystery_status')).toBeTruthy();
  });

  it('says so when there are none', async () => {
    await renderApp(<CampaignsCard data={emptyWidgets.campaigns} />);
    expect(screen.getByText('No active campaigns')).toBeTruthy();
  });
});

describe('TemplatesCard', () => {
  it('shows each template with its status and its send, delivery and read figures', async () => {
    await renderApp(<TemplatesCard data={widgets.templates} />);
    expect(screen.getByText('2 templates')).toBeTruthy();
    expect(screen.getByText('order_update')).toBeTruthy();
    expect(screen.getByText('EN - UTILITY - text')).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.getByText('900')).toBeTruthy();
    expect(screen.getByText('66.7%')).toBeTruthy();
  });

  it('shows dashes for a template that was never sent and its review state', async () => {
    await renderApp(<TemplatesCard data={widgets.templates} />);
    expect(screen.getByText('welcome_back')).toBeTruthy();
    expect(screen.getByText('In review')).toBeTruthy();
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(4);
  });

  it('says so when there are none', async () => {
    await renderApp(<TemplatesCard data={emptyWidgets.templates} />);
    expect(screen.getByText('No templates yet.')).toBeTruthy();
  });
});

describe('DevicesCard', () => {
  it('shows each paired number with its state, region, volume and delivery rate', async () => {
    await renderApp(<DevicesCard data={widgets.devices} />);
    expect(screen.getByText('2 of 6 slots used - 1 online')).toBeTruthy();
    expect(screen.getByText('+919876500001')).toBeTruthy();
    expect(screen.getByText('Sales phone - IN - 40/24h')).toBeTruthy();
    expect(screen.getByText('Online')).toBeTruthy();
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.getByText('97% deliv')).toBeTruthy();
    expect(screen.getByText('4 device slots available')).toBeTruthy();
  });

  it('falls back to the label and "unzoned" for a device without a number or region', async () => {
    await renderApp(<DevicesCard data={widgets.devices} />);
    expect(screen.getByText('Support phone')).toBeTruthy();
    expect(screen.getByText('Support phone - unzoned - 0/24h')).toBeTruthy();
  });

  it('says so when no device is paired', async () => {
    await renderApp(<DevicesCard data={{ ...emptyWidgets.devices, total: 6 }} />);
    expect(screen.getByText('No devices connected')).toBeTruthy();
    expect(screen.queryByText(/slot/)).toBeTruthy();
  });
});

describe('InstagramBand', () => {
  it('shows the linked accounts and the five numbers', async () => {
    await renderApp(<InstagramBand data={widgets.instagram!} />);
    expect(screen.getByText('2 accounts')).toBeTruthy();
    expect(screen.getByLabelText('@acme.shop, Connected')).toBeTruthy();
    expect(screen.getByLabelText('@acme.deals, expired')).toBeTruthy();
    expect(screen.getByText('Need reply')).toBeTruthy();
    expect(screen.getByText('12.4k')).toBeTruthy();
    expect(screen.getByText('DMs in · 7d')).toBeTruthy();
  });
});

describe('IntegrationsCard', () => {
  it('shows what is connected, with the weekly events where there are some', async () => {
    await renderApp(<IntegrationsCard data={widgets.integrations} />);
    expect(screen.getByText('2 / 4')).toBeTruthy();
    expect(screen.getByText('WooCommerce')).toBeTruthy();
    expect(screen.getByText('25 events / 7d')).toBeTruthy();
    expect(screen.getByText('API key issued')).toBeTruthy();
    expect(screen.getAllByText('not connected')).toHaveLength(2);
    expect(screen.getAllByText('Connected')).toHaveLength(2);
  });
});

describe('InboxCard', () => {
  it('shows how many are waiting, for how long, and the latest conversations', async () => {
    await renderApp(<InboxCard data={widgets.inbox} now={NOW} />);
    expect(screen.getByText('3 unread - oldest 2 hours ago')).toBeTruthy();
    expect(screen.getByText('Asha Verma')).toBeTruthy();
    expect(screen.getByText('30 minutes ago')).toBeTruthy();
    expect(screen.getByText('Can you share the price list?')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('Ravi Kumar')).toBeTruthy();
  });

  it('says so when there are no conversations', async () => {
    await renderApp(<InboxCard data={emptyWidgets.inbox} now={NOW} />);
    expect(screen.getByText('0 unread')).toBeTruthy();
    expect(screen.getByText('No conversations yet.')).toBeTruthy();
  });
});

describe('FlowsCard', () => {
  it('shows the counters and the latest flows with their trigger and state', async () => {
    await renderApp(<FlowsCard data={widgets.flows} />);
    expect(screen.getByText('3 active · 1200 subscribers')).toBeTruthy();
    expect(screen.getByText('1.2k')).toBeTruthy();
    expect(screen.getByText('Order follow-up')).toBeTruthy();
    expect(screen.getByText('Order paid trigger · 6 steps · 840 subscribers')).toBeTruthy();
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Paused')).toBeTruthy();
  });

  it('says so when there are none', async () => {
    await renderApp(<FlowsCard data={emptyWidgets.flows} />);
    expect(screen.getByText('No flows yet.')).toBeTruthy();
  });
});

describe('ActivityCard', () => {
  it('shows who did what, and how long ago', async () => {
    await renderApp(<ActivityCard data={widgets.activity} now={NOW} />);
    expect(screen.getByText('Asha - contacts imported 40 contacts')).toBeTruthy();
    expect(screen.getByText('15 minutes ago')).toBeTruthy();
    expect(screen.getByText('- - billing renewed the plan')).toBeTruthy();
  });

  it('says so when nothing happened', async () => {
    await renderApp(<ActivityCard data={[]} now={NOW} />);
    expect(screen.getByText('No recent activity logged for this workspace.')).toBeTruthy();
  });
});

describe('PipelineCard', () => {
  it('shows the open value, deals, won this month and win rate', async () => {
    await renderApp(<PipelineCard data={widgets.pipeline!} />);
    expect(screen.getByText('Sales pipeline')).toBeTruthy();
    expect(screen.getByText(/125,000\.00/)).toBeTruthy();
    expect(screen.getByText('14')).toBeTruthy();
    expect(screen.getByText(/45,000\.00/)).toBeTruthy();
    expect(screen.getByText('38%')).toBeTruthy();
  });
});

describe('FunnelCard', () => {
  it('reads each stage out with its count and share, and shows the activity and the comparison', async () => {
    await renderApp(<FunnelCard funnel={summary.funnel} subtitle="Last 7 days" />);
    expect(screen.getByText('Last 7 days')).toBeTruthy();
    expect(
      screen.getByLabelText('Contacts messaged: 120 contacts, 100% of contacts messaged'),
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Goal completed: 12 contacts, 10% of contacts messaged'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        '150 inbound messages · 40 responding contacts · 3.8 replies per responding contact',
      ),
    ).toBeTruthy();
    expect(screen.getByText('33.3%')).toBeTruthy();
    expect(screen.getByLabelText('Up 3.2 pp against the previous period')).toBeTruthy();
  });

  it('leaves out the comparison when the previous window had no contacts, and shows a dash for no replies', async () => {
    const funnel = {
      ...summary.funnel,
      comparison: null,
      activity: { inbound: 1, respondingContacts: 1, repliesPerContact: null },
    };
    await renderApp(<FunnelCard funnel={funnel} subtitle="Last 7 days" />);
    expect(screen.queryByTestId('funnel-comparison')).toBeNull();
    expect(
      screen.getByText(
        '1 inbound message · 1 responding contact · - replies per responding contact',
      ),
    ).toBeTruthy();
  });
});

describe('ThroughputPanel', () => {
  it('shows the peak, the legend with totals, the chart and the four figures', async () => {
    await renderApp(
      <ThroughputPanel
        rangeName="7 Oct – 12 Oct 2026"
        summary={summary}
        throughput={throughput}
        failed={false}
        timezone="UTC"
      />,
    );
    expect(screen.getByText('Per day · 7 Oct – 12 Oct 2026')).toBeTruthy();
    expect(screen.getByText('Peak hour Oct 7 · 87 messages')).toBeTruthy();
    expect(screen.getByText('Sent 1.3k')).toBeTruthy();
    expect(screen.getByText('Delivered 1.2k')).toBeTruthy();
    expect(screen.getByText('Failed 20')).toBeTruthy();
    expect(
      screen.getByRole('image', {
        name: '1250 sent, 1180 delivered and 20 failed in this period.',
      }),
    ).toBeTruthy();
    expect(screen.getByText('Average per hour')).toBeTruthy();
    expect(screen.getByText('33.3%')).toBeTruthy();
  });

  it('labels an hourly chart by the hour', async () => {
    await renderApp(
      <ThroughputPanel
        rangeName="12 Oct 2026"
        summary={summary}
        throughput={{
          ...throughput,
          bucket: 'hour',
          peak: null,
          starts: ['2026-10-10T09:00:00.000Z'],
          sent: [1],
          delivered: [1],
          failed: [0],
        }}
        failed={false}
        timezone="UTC"
      />,
    );
    expect(screen.getByText('14:30')).toBeTruthy(); // 09:00 UTC in the workspace zone (Asia/Kolkata)
    expect(screen.queryByText(/Peak hour/)).toBeNull();
  });

  it('shows a spinner while loading and a message when the request failed', async () => {
    const { rerender } = await renderApp(
      <ThroughputPanel
        rangeName="7 Oct – 12 Oct 2026"
        summary={undefined}
        throughput={undefined}
        failed={false}
        timezone="UTC"
      />,
    );
    expect(screen.getByLabelText('Loading…')).toBeTruthy();
    await rerender(
      <ThroughputPanel
        rangeName="7 Oct – 12 Oct 2026"
        summary={undefined}
        throughput={undefined}
        failed
        timezone="UTC"
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
