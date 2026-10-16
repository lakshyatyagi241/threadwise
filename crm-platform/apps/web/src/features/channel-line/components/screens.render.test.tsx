import { describe, expect, it, vi } from 'vitest';
import type {
  LineAudienceList,
  LineBroadcast,
  LineBroadcastCompose,
  LineBroadcastList,
  LineChannelResponse,
} from '@crm/contracts';
import { KEYS } from '../api/line';
import { BroadcastsScreen } from './broadcasts-screen';
import { ChannelCard } from './channel-card';
import { ComposeScreen } from './compose-screen';
import { HubScreen } from './hub-screen';
import { render } from './render-utils';

const LOCALES = [
  'en',
  'es',
  'hi',
  'ar',
  'pt',
  'ru',
  'ja',
  'de',
  'fr',
  'it',
  'ko',
  'zh-CN',
  'tr',
  'id',
  'vi',
  'th',
  'pl',
  'nl',
  'ur',
  'he',
  'bn',
];
const CH = '0b6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f50';
const BC = '7b6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f77';
let perms: Record<string, boolean> = {};

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (key: string) => perms[key] === true,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const channel = (over: Partial<LineChannelResponse> = {}): LineChannelResponse => ({
  id: CH,
  lineChannelId: 'U4af4980629abcdef',
  basicId: '@shopline',
  displayName: 'Shop LINE',
  pictureUrl: null,
  active: true,
  connectedAt: '2026-10-01T10:00:00.000Z',
  lastInboundAt: '2026-10-14T09:30:00.000Z',
  lastError: null,
  assertionKid: null,
  rotationEnabled: false,
  rotationExpiresAt: null,
  webhookUrl:
    'https://app.example.com/v2/line/inbound/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ',
  rowVersion: 1,
  ...over,
});
const broadcast = (over: Partial<LineBroadcast> = {}): LineBroadcast => ({
  id: BC,
  name: 'Weekend sale',
  channelId: CH,
  channelName: 'Shop LINE',
  templateId: null,
  status: 'draft',
  total: 40,
  sent: 0,
  failed: 0,
  blocked: 0,
  progress: 0,
  held: 0,
  heldUntil: null,
  hasMedia: false,
  lastError: null,
  startedAt: null,
  finishedAt: null,
  createdAt: '2026-10-14T08:00:00.000Z',
  ...over,
});
const list = (data: LineBroadcast[]): LineBroadcastList => ({
  data,
  stats: { total: data.length, sent: 12, failed: 1, blocked: 2, audience: 40, sending: 0 },
});
const compose: LineBroadcastCompose = {
  channels: [{ id: CH, displayName: 'Shop LINE', basicId: '@shopline', active: true }],
  templates: [
    {
      id: 'a1b2c3d4-3c1d-4d6e-9a41-6b1c2d3e4f01',
      name: 'Offer',
      body: 'Offer for {{name}}',
      buttons: [
        { type: 'url', text: 'Shop', url: 'https://x.test' },
        { type: 'quick_reply', text: 'Later' },
      ],
    },
  ],
};
const audience: LineAudienceList = {
  data: [
    { userId: 'Uaaa', title: 'Asha Rao', lastMessageAt: '2026-10-14T08:00:00.000Z', unread: 1 },
    { userId: 'Ubbb', title: 'Ravi', lastMessageAt: null, unread: 0 },
  ],
};

describe('the channel card', () => {
  it('shows a healthy channel with its manage actions and no secret', () => {
    perms = {};
    const html = render(<ChannelCard channel={channel()} canManage />);
    expect(html).toContain('Shop LINE');
    expect(html).toContain('@shopline');
    expect(html).toContain('Active');
    for (const label of [
      'Re-hook',
      'Pause',
      'Remove',
      'Token rotation (v2.1)',
      'Enable rotation',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('Needs attention');
    // The channel carries only the bot user id, so the numeric Channel ID is asked for.
    expect(html).toContain('Numeric Channel ID from the LINE console');
  });

  it('a paused channel offers Enable; an error reads Needs attention with the reason', () => {
    expect(render(<ChannelCard channel={channel({ active: false })} canManage />)).toContain(
      '>Enable<',
    );
    const html = render(
      <ChannelCard channel={channel({ lastError: 'The webhook URL is invalid' })} canManage />,
    );
    expect(html).toContain('Needs attention');
    expect(html).toContain('The webhook URL is invalid');
  });

  it('with rotation on it says so, offers Re-issue and no longer asks for the Channel ID', () => {
    const html = render(
      <ChannelCard
        channel={channel({
          lineChannelId: '1234567890',
          rotationEnabled: true,
          assertionKid: 'kid-1',
          rotationExpiresAt: '2026-11-10T10:00:00.000Z',
        })}
        canManage
      />,
    );
    expect(html).toContain('Re-issue / update');
    expect(html).toContain('renews');
    expect(html).not.toContain('Numeric Channel ID from the LINE console');
  });

  it('without the manage permission there is nothing to press', () => {
    const html = render(<ChannelCard channel={channel()} canManage={false} />);
    expect(html).not.toContain('Re-hook');
    expect(html).not.toContain('Remove');
    expect(html).not.toContain('Token rotation');
  });
});

describe('the hub', () => {
  it('lists the connected channels with the connect form and the guide', () => {
    perms = { 'line.channels.manage': true, 'line.broadcasts.read': true };
    const html = render(<HubScreen />, { seed: [[KEYS.channels, { data: [channel()] }]] });
    expect(html).toContain('Official Account');
    expect(html).toContain('Connect a channel');
    expect(html).toContain('Connect LINE');
    expect(html).toContain('Connected channels');
    expect(html).toContain('Shop LINE');
    expect(html).toContain('href="/line/broadcasts"');
    expect(html).toContain('How to connect');
    // Rich menus and insights are not built: no dead links to them.
    expect(html).not.toContain('Rich menus');
    expect(html).not.toContain('/line/rich-menus');
  });

  it('a reader sees the channels but no connect form and no management', () => {
    perms = { 'line.channels.read': true };
    const html = render(<HubScreen />, { seed: [[KEYS.channels, { data: [channel()] }]] });
    expect(html).not.toContain('Connect LINE');
    expect(html).not.toContain('Re-hook');
    expect(html).not.toContain('href="/line/broadcasts"');
  });
});

describe('the broadcast list', () => {
  it('shows the tiles, the rows and an action for each state', () => {
    perms = { 'line.broadcasts.manage': true };
    const rows = [
      broadcast({ name: 'Draft one' }),
      broadcast({ id: 'b2', name: 'Live one', status: 'sending', sent: 10, progress: 25 }),
      broadcast({ id: 'b3', name: 'Done one', status: 'done', sent: 38, failed: 2, progress: 100 }),
    ];
    const html = render(<BroadcastsScreen />, {
      seed: [
        [KEYS.channels, { data: [channel()] }],
        [KEYS.broadcasts, list(rows)],
      ],
    });
    for (const text of [
      'Sent',
      'Audience',
      'Failed',
      'Blocked',
      'Sending',
      'Draft one',
      'Live one',
      'Done one',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('>Start<');
    expect(html).toContain('>Pause<');
    expect(html).toContain('>Retry<');
    expect(html).toContain('38 sent · 2 failed · 0 blocked');
    expect(html).toContain('href="/line/broadcasts/create"');
  });

  it('with no channel it asks to connect one first', () => {
    perms = { 'line.broadcasts.manage': true };
    const html = render(<BroadcastsScreen />, {
      seed: [
        [KEYS.channels, { data: [] }],
        [KEYS.broadcasts, list([])],
      ],
    });
    expect(html).toContain('Connect a LINE channel first.');
    expect(html).not.toContain('New broadcast');
  });

  it('a viewer sees the list without any action', () => {
    perms = { 'line.broadcasts.read': true };
    const html = render(<BroadcastsScreen />, {
      seed: [
        [KEYS.channels, { data: [channel()] }],
        [KEYS.broadcasts, list([broadcast()])],
      ],
    });
    expect(html).toContain('Weekend sale');
    expect(html).not.toContain('>Start<');
    expect(html).not.toContain('New broadcast');
  });
});

describe('the compose screen', () => {
  const seed = [
    [KEYS.compose, compose],
    [KEYS.audience(CH), audience],
  ] as const;

  it('offers the setup fields, the template, the recipients and a preview', () => {
    perms = { 'line.broadcasts.manage': true };
    const html = render(<ComposeScreen />, { seed });
    for (const text of [
      'Broadcast setup',
      'Broadcast name',
      'Shop LINE',
      'Template (optional)',
      'Offer · 2 button(s)',
      'Asha Rao',
      'Ravi',
      '0 selected',
      'Create broadcast',
      'Live preview',
      'Your message preview…',
    ]) {
      expect(html).toContain(text);
    }
    // Nothing is ticked, so the submit button is disabled.
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });

  it('a person without the manage permission is told so and cannot submit', () => {
    perms = { 'line.broadcasts.read': true };
    const html = render(<ComposeScreen />, { seed });
    expect(html).toContain('not allowed to create broadcasts');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });
});

describe('every message the screens ask for exists in all 21 languages', () => {
  it.each(LOCALES)('%s', (locale) => {
    perms = {
      'line.channels.manage': true,
      'line.broadcasts.manage': true,
      'line.broadcasts.read': true,
    };
    const opts = {
      locale,
      seed: [
        [
          KEYS.channels,
          {
            data: [
              channel(),
              channel({
                id: 'c2',
                lineChannelId: '99',
                rotationEnabled: true,
                active: false,
                lastError: 'x',
              }),
            ],
          },
        ],
        [
          KEYS.broadcasts,
          list([broadcast(), broadcast({ id: 'b2', status: 'failed', lastError: 'y' })]),
        ],
        [KEYS.compose, compose],
        [KEYS.audience(CH), audience],
      ],
    } as const;
    expect(render(<HubScreen />, opts)).not.toBe('');
    expect(render(<BroadcastsScreen />, opts)).not.toBe('');
    expect(render(<ComposeScreen />, opts)).not.toBe('');
    expect(render(<ChannelCard channel={channel()} canManage />, opts)).not.toBe('');
  });
});
