import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WARMER_DEFAULTS,
  type ScheduleDetail,
  type ScheduleList,
  type ScheduleOptions,
  type ScheduleSummary,
  type WarmerList,
} from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { initialDraft, type Draft } from '../lib/composer-model';

const state = vi.hoisted(() => ({
  list: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown },
  options: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown },
  detail: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown },
  warmer: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown },
  preview: { data: undefined as unknown, isFetching: false },
  can: true,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/scheduled',
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => state.can,
}));
vi.mock('../api/schedules', () => ({
  KEYS: { all: ['sched'], warmer: ['sched', 'warmer'] },
  refresh: () => undefined,
  scheduleApi: {},
  warmerApi: {},
  useSchedules: () => state.list,
  useScheduleOptions: () => state.options,
  useScheduleDetail: () => state.detail,
  useWarmer: () => state.warmer,
  useAudiencePreview: () => state.preview,
  useCreateSchedule: () => ({ mutate: () => undefined, isPending: false }),
}));

import { ApiError } from '@/lib/api/errors';
import { ComposerScreen } from './composer-screen';
import { AudienceStep, MessageStep, ReviewStep, WhenStep } from './composer-steps';
import { DetailScreen } from './detail-screen';
import { ScheduledScreen } from './scheduled-screen';
import { WarmerScreen } from './warmer-screen';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'scheduled-queue-warmer.json'), 'utf8'),
) as Record<string, unknown>;

const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const G1 = '11111111-1111-4111-8111-111111111111';

const summary = (over: Partial<ScheduleSummary> = {}): ScheduleSummary => ({
  id: G1,
  name: 'Spring promo',
  status: 'scheduled',
  scheduleType: 'once',
  recipientType: 'group',
  messageType: 'plain',
  senderLabel: 'Shop line',
  provider: 'baileys',
  scheduledAt: '2026-10-10T10:00:00.000Z',
  nextRunAt: '2026-10-10T10:00:00.000Z',
  lastRunAt: null,
  timezone: 'UTC',
  repeatInterval: null,
  totalRecipients: 1200,
  totalSent: 0,
  totalDelivered: 0,
  totalFailed: 0,
  lastError: null,
  rowVersion: 1,
  ...over,
});

const options: ScheduleOptions = {
  minLeadMinutes: 2,
  senders: [
    {
      key: 'baileys:a',
      engine: 'baileys',
      label: 'Shop line',
      phone: '919800000001',
      warming: true,
    },
    { key: 'waba:b', engine: 'waba', label: 'Cloud line', phone: '919800000002', warming: false },
  ],
  groups: [{ id: G1, name: 'VIP', members: 40 }],
  tags: [],
  queues: [],
  templates: [{ id: G1, name: 'spring_promo', language: 'en' }],
};

beforeEach(() => {
  state.can = true;
  state.list = { data: undefined, isPending: false, isError: false, error: null };
  state.options = { data: options, isPending: false, isError: false, error: null };
  state.preview = { data: undefined, isFetching: false };
});

describe('scheduled list screen', () => {
  const list = (items: ScheduleSummary[], upNext: ScheduleSummary | null = null): ScheduleList => ({
    items,
    total: items.length,
    stats: { all: 7, upcoming: 3, running: 1, paused: 1, completed: 1, failed: 1 },
    upNext,
  });

  it('shows the strip, the up next card, the six tabs with counts and a row with its actions', () => {
    const row = summary();
    state.list.data = list(
      [
        row,
        summary({ id: '22222222-2222-4222-8222-222222222222', status: 'failed', name: 'Broken' }),
      ],
      row,
    );
    const out = html(<ScheduledScreen />);
    for (const s of [
      'Scheduled messages',
      'Total scheduled',
      'Active queue',
      'Total sent',
      'Delivery rate',
      'Next to fire',
      'Spring promo',
      '1,200 / Group',
      'Queued',
      'Failed',
      'Schedule message',
      '4 queued',
    ]) {
      expect(out).toContain(s);
    }
    for (const tab of ['All', 'Upcoming', 'Running', 'Paused', 'Completed', 'Failed'])
      expect(out).toContain(tab);
    // queued row: pause, run now, cancel, delete; failed row: retry.
    for (const label of [
      'Pause',
      'Run now',
      'Cancel',
      'Delete',
      'Retry with new time',
      'Delete from history',
    ]) {
      expect(out).toContain(`aria-label="${label}"`);
    }
  });

  it('without the manage permission there are no create link or row actions', () => {
    state.can = false;
    state.list.data = list([summary()]);
    const out = html(<ScheduledScreen />);
    expect(out).not.toContain('/scheduled/create');
    expect(out).not.toContain('aria-label="Pause"');
    expect(out).toContain('aria-label="Open"');
  });

  it('empty and loading states, and an upgrade pointer for a plan refusal', () => {
    state.list.data = list([]);
    expect(html(<ScheduledScreen />)).toContain('Schedule your first message.');
    state.list = { data: undefined, isPending: true, isError: false, error: null };
    expect(html(<ScheduledScreen />)).toContain('Total scheduled');
    state.list = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new ApiError(403, 'PLAN_FEATURE_LOCKED', 'locked'),
    };
    expect(html(<ScheduledScreen />)).toContain('Your plan does not include this feature.');
  });
});

describe('composer screen', () => {
  it('opens on the basics step with the sender picker, the type tiles and the stepper', () => {
    const out = html(<ComposerScreen />);
    for (const s of [
      'Schedule a message',
      'Schedule basics',
      'Schedule name',
      'Shop line',
      'Cloud line',
      'Warming',
      'Plain text',
      'Template',
      'With media',
      'Location',
      'Step 1 of 5',
      'Basics',
      'Recipients',
      'Message',
      'When',
      'Review',
    ]) {
      expect(out).toContain(s);
    }
  });

  it('needs the manage permission, and shows a load failure', () => {
    state.can = false;
    expect(html(<ComposerScreen />)).toContain('You do not have permission to schedule messages.');
    state.can = true;
    state.options = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new ApiError(500, 'INTERNAL', 'boom'),
    };
    expect(html(<ComposerScreen />)).toContain('boom');
  });

  const step = (over: Partial<Draft> = {}) => ({
    draft: { ...initialDraft(Date.UTC(2026, 9, 10, 10, 0), 'UTC'), ...over },
    set: () => undefined,
    errors: {},
    server: [],
    options,
  });

  it('audience step: the total and the opted out count', () => {
    const out = html(
      <AudienceStep
        {...step({ groupIds: [G1] })}
        previewing={false}
        preview={{ total: 38, optedOut: 2, sample: [] }}
      />,
    );
    expect(out).toContain('VIP');
    expect(out).toContain('38');
    expect(out).toContain('2 left out: opted out or archived');
  });

  it('message step: counter and personalisation chips; template picker; media link; location', () => {
    expect(html(<MessageStep {...step()} total={120} />)).toContain('/ 1024');
    expect(html(<MessageStep {...step()} total={120} />)).toContain('about 2 min');
    expect(html(<MessageStep {...step({ messageType: 'template' })} total={0} />)).toContain(
      'Choose an approved template',
    );
    expect(html(<MessageStep {...step({ messageType: 'media' })} total={0} />)).toContain(
      'Media link',
    );
    expect(html(<MessageStep {...step({ messageType: 'location' })} total={0} />)).toContain(
      'Latitude',
    );
  });

  it('when step: weekdays and end date appear for a weekly recurrence only', () => {
    expect(html(<WhenStep {...step()} />)).not.toContain('Days of week');
    const out = html(<WhenStep {...step({ scheduleType: 'recurring', endMode: 'date' })} />);
    for (const s of ['Days of week', 'Repeat every', 'Last day', 'Mon', 'Sun'])
      expect(out).toContain(s);
  });

  it('review step: the test number field appears once the switch is on, with its error', () => {
    expect(html(<ReviewStep {...step()} />)).not.toContain('Send a test to this number');
    const out = html(
      <ReviewStep
        {...{ ...step({ sendTest: true }), errors: { testNumber: 'testNumber' } }}
        preview={{ total: 10, optedOut: 0, sample: [] }}
      />,
    );
    expect(out).toContain('Send a test to this number');
    expect(out).toContain('Enter the number with its country code.');
  });

  it('shows the server message next to its field', () => {
    const out = html(
      <MessageStep
        {...{ ...step(), server: [{ path: 'message', message: 'Too spicy for WhatsApp' }] }}
        total={0}
      />,
    );
    expect(out).toContain('Too spicy for WhatsApp');
  });
});

describe('detail screen', () => {
  const detail = (over: Partial<ScheduleDetail> = {}): ScheduleDetail => ({
    ...summary({ status: 'paused', totalSent: 5 }),
    message: 'Hi there',
    media: null,
    latitude: null,
    longitude: null,
    repeatEvery: 1,
    daysOfWeek: [],
    endDate: null,
    sendDate: '2026-10-10',
    sendTime: '10:00',
    failureReason: null,
    sendAttempts: 1,
    breakdown: { pending: 3, sent: 1, delivered: 1, read: 1, failed: 1 },
    recipients: [
      {
        phone: '9198****0001',
        contactName: 'Asha',
        status: 'read',
        error: null,
        sentAt: null,
        deliveredAt: null,
        readAt: '2026-10-10T10:05:00.000Z',
      },
      {
        phone: '9198****0002',
        contactName: null,
        status: 'failed',
        error: 'Not on WhatsApp',
        sentAt: null,
        deliveredAt: null,
        readAt: null,
      },
    ],
    recipientsTruncated: true,
    ...over,
  });

  it('shows stats, funnel, recipients with status and note, config, preview, and actions for a paused schedule', () => {
    state.detail.data = detail();
    const out = html(<DetailScreen id={G1} />);
    for (const s of [
      'Spring promo',
      'Delivery funnel',
      'Who got what',
      'Asha',
      '+9198****0001',
      'Not on WhatsApp',
      'Hi there',
      'Resume',
      'Run now',
      'Cancel',
      'Delete',
      'Showing the first 2 of 1,200 recipients.',
      'Pending',
    ]) {
      expect(out).toContain(s);
    }
    expect(out).not.toContain('>Pause<');
    expect(out).not.toContain('Retry with new time');
  });

  it('a failed schedule offers retry and shows why it failed', () => {
    state.detail.data = detail({ status: 'failed', failureReason: 'Sender disconnected' });
    const out = html(<DetailScreen id={G1} />);
    expect(out).toContain('Retry with new time');
    expect(out).toContain('Sender disconnected');
    expect(out).not.toContain('>Run now<');
  });

  it('shows the error when the schedule cannot be loaded', () => {
    state.detail = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new ApiError(404, 'NOT_FOUND', 'No such schedule'),
    };
    expect(html(<DetailScreen id={G1} />)).toContain('No such schedule');
  });
});

describe('warmer screen', () => {
  const list = (): WarmerList => ({
    defaults: { ...WARMER_DEFAULTS },
    items: [
      {
        key: 'baileys:a',
        engine: 'baileys',
        label: 'Shop line',
        phone: '919800000001',
        status: 'connected',
        profile: { ...WARMER_DEFAULTS, enabled: true },
        startedAt: null,
        budget: 20,
        sentToday: 5,
        remaining: 15,
        health: 55,
      },
      {
        key: 'waba:b',
        engine: 'waba',
        label: 'Cloud line',
        phone: null,
        status: 'connected',
        profile: { ...WARMER_DEFAULTS },
        startedAt: null,
        budget: 20,
        sentToday: 0,
        remaining: 20,
        health: 90,
      },
    ],
  });

  it('shows the rail, the four tiles and one card per number with every setting', () => {
    state.warmer.data = list();
    const out = html(<WarmerScreen />);
    for (const s of [
      '1 warming',
      'How it works',
      'Good to know',
      'Numbers warming',
      'Today&#x27;s budget',
      'Avg health',
      'Shop line',
      'Unofficial API',
      'WABA',
      'Health 55',
      'Remaining today',
      'Start budget/day',
      'Ramp +% / step',
      'Ramp every (days)',
      'Max budget/day',
      'Min gap (sec)',
      'Max gap (sec)',
      'Active from (hr)',
      'Active to (hr)',
      'Spintax variety',
      'Save warm-up',
    ]) {
      expect(out).toContain(s);
    }
    expect(out.match(/role="switch"/g)).toHaveLength(2);
    expect(out).toContain('aria-checked="true"');
  });

  it('says so when no number is connected', () => {
    state.warmer.data = { defaults: { ...WARMER_DEFAULTS }, items: [] };
    expect(html(<WarmerScreen />)).toContain('No connected numbers yet.');
  });
});
