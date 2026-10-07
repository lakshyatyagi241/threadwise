import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PERSONAL_WA_NOTICE_ITEMS,
  PERSONAL_WA_NOTICE_VERSION,
  type DevicePairing,
  type ListDevicesResponse,
  type PersonalDevice,
  type PersonalDeviceDetail,
} from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';
import { ApiError } from '@/lib/api/errors';

const state = vi.hoisted(() => ({
  list: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown },
  detail: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown },
  notice: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown },
  can: new Set<string>(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/devices',
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (key: string) => state.can.has(key),
}));
vi.mock('../api/devices', () => {
  const idle = { mutate: () => undefined, isPending: false };
  return {
    KEYS: {
      all: ['wadev'],
      list: ['wadev', 'list'],
      pairing: (id: string) => ['wadev', 'pairing', id],
    },
    deviceApi: {},
    useDevices: () => state.list,
    useDevice: () => state.detail,
    useRiskNotice: () => state.notice,
    useAcknowledgeRisk: () => idle,
    useCreateDevice: () => idle,
    useUpdateDevice: () => idle,
    useStartPairing: () => idle,
    useEndPairing: () => idle,
    useDisconnectDevice: () => idle,
    useDeleteDevice: () => idle,
  };
});
vi.mock('./use-pairing-poll', () => ({
  usePairingPoll: () => ({ data: undefined, receivedAt: 0, gone: false, error: null }),
  useNow: () => 0,
}));

import { ConnectWizard } from './connect-wizard';
import { DeviceDetailScreen } from './device-detail-screen';
import { DeleteDialog, DisconnectDialog, RenameDialog } from './device-dialogs';
import { DevicesScreen } from './devices-screen';
import { NoticeScreen } from './notice-screen';
import { CodePanel, ProgressStrip, QrPanel } from './pairing-panel';
import { StateBadge } from './state-badge';
import { MethodChoice, NoticeStep, NumberStep, ResultStep } from './wizard-steps';
import { EMPTY_DRAFT, tick, NO_ACKS } from '../lib/wizard-model';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const U1 = '33333333-3333-4333-8333-333333333333';
const FAKE_QR = '2@SECRETQRPAYLOAD0123456789/abcdef==,xyz';
const ALL = [
  'wa.devices.read',
  'wa.devices.create',
  'wa.devices.pair',
  'wa.devices.disconnect',
  'wa.devices.delete',
];

const render = (el: ReactElement, locale: 'en' | 'ar' = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const device = (over: Partial<PersonalDevice> = {}): PersonalDevice => ({
  id: D1,
  name: 'Sales line',
  phone: '+917690059356',
  countryCode: '+91',
  region: 'IN',
  connectionState: 'connected',
  stateReason: null,
  stateChangedAt: '2026-10-07T09:00:00.000Z',
  status: 'connected',
  active: true,
  activateAfterPairing: true,
  lastSeenAt: '2026-10-07T09:30:00.000Z',
  assignee: { id: U1, name: 'Anna' },
  createdBy: { id: U1, name: 'Anna' },
  proxy: { enabled: false, status: null, egressIp: null },
  sent24h: 0,
  failed24h: 0,
  createdAt: '2026-10-06T09:00:00.000Z',
  rowVersion: 3,
  ...over,
});

const list = (
  data: PersonalDevice[],
  meta: Partial<ListDevicesResponse['meta']> = {},
): ListDevicesResponse => ({
  data,
  page: { nextCursor: null, hasMore: false, limit: 100 },
  meta: {
    used: data.length,
    limit: 2,
    planLimit: 0,
    pilotCap: 2,
    noticeVersion: PERSONAL_WA_NOTICE_VERSION,
    noticeAccepted: true,
    workerRunning: true,
    ...meta,
  },
});

beforeEach(() => {
  state.can = new Set(ALL);
  state.list = { data: undefined, isPending: false, isError: false, error: null };
  state.detail = { data: undefined, isPending: false, isError: false, error: null };
  state.notice = { data: undefined, isPending: false, isError: false, error: null };
});

for (const locale of ['en', 'ar'] as const) {
  const m = loadMessages(locale) as { 'whatsapp-devices-baileys': Record<string, unknown> };
  const root = m['whatsapp-devices-baileys'] as Record<string, Record<string, unknown>>;
  const at = (path: string): string =>
    path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], root) as string;
  const out = (el: ReactElement) => render(el, locale);

  describe(`devices list (${locale})`, () => {
    it('shows the reminder, the Unofficial badge, the cap meter and a card per number with its status pill', () => {
      state.list.data = list([
        device(),
        device({ id: D2, name: 'Support', connectionState: 'awaiting_qr', status: 'needs_pair' }),
      ]);
      const html = out(<DevicesScreen />);
      expect(html).toContain(at('common.reminder'));
      expect(html).toContain(at('common.unofficial'));
      expect(html).toContain(at('list.title'));
      expect(html).toContain('data-testid="cap-meter"');
      expect(html).toContain(at('state.connected'));
      expect(html).toContain(at('state.awaiting_qr'));
      expect((html.match(/data-testid="device-card"/g) ?? []).length).toBe(2);
      expect(html).toContain('href="/help/personal-whatsapp-connect"');
      // the number is isolated left-to-right so it reads correctly in right-to-left pages
      expect(html).toContain('dir="ltr"');
      expect(html).toContain('+917690059356');
    });

    it('at the cap the connect button is disabled and the cap message explains why', () => {
      state.list.data = list([device(), device({ id: D2, name: 'Support' })], {
        used: 2,
        limit: 2,
      });
      const html = out(<DevicesScreen />);
      expect(html).toContain('data-testid="cap-full"');
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*<\/button>/);
      expect(html).toContain(at('list.connect'));
    });

    it('offers the right primary action per state and never a link button for a connecting number', () => {
      state.list.data = list([
        device({
          id: D1,
          name: 'A',
          connectionState: 'logged_out',
          status: 'disconnected',
          stateReason: 'unlinked_on_phone',
        }),
        device({ id: D2, name: 'B', connectionState: 'connecting', status: 'needs_pair' }),
      ]);
      const html = out(<DevicesScreen />);
      expect(html).toContain(at('list.action.relink'));
      expect(html).toContain(at('reason.unlinked_on_phone'));
      expect(html).toContain(at('state.connecting'));
      expect(html).not.toContain(at('state.created'));
    });

    it('empty state names the next action; without permission it says who to ask', () => {
      state.list.data = list([], { used: 0 });
      expect(out(<DevicesScreen />)).toContain(at('list.empty.title'));
      expect(out(<DevicesScreen />)).toContain(at('list.empty.action'));
      state.can = new Set(['wa.devices.read']);
      expect(out(<DevicesScreen />)).toContain(at('list.empty.noPermission'));
    });

    it('hides the actions a member may not take', () => {
      state.can = new Set(['wa.devices.read']);
      state.list.data = list([device({ connectionState: 'disconnected', status: 'disconnected' })]);
      const html = out(<DevicesScreen />);
      expect(html).not.toContain(`>${at('list.action.reconnect')}<`);
      expect(html).not.toContain(`>${at('list.action.rename')}<`);
      expect(html).not.toContain(`>${at('list.action.delete')}<`);
      expect(html).toContain(at('list.action.details'));
    });

    it('shows the notice-changed banner, the worker line and the loading state', () => {
      state.list.data = list([device()], { noticeAccepted: false, workerRunning: false });
      const html = out(<DevicesScreen />);
      expect(html).toContain('data-testid="notice-changed"');
      expect(html).toContain(at('list.noticeChanged.title'));
      expect(html).toContain('data-testid="worker-down"');
      state.list = { data: undefined, isPending: true, isError: false, error: null };
      expect(out(<DevicesScreen />)).toContain(at('list.loading'));
    });

    it('translates refusals by code and never shows a raw code', () => {
      state.list = {
        data: undefined,
        isPending: false,
        isError: true,
        error: new ApiError(422, 'WA_UNOFFICIAL_DISABLED', 'ignored server text'),
      };
      const html = out(<DevicesScreen />);
      expect(html).toContain(at('errors.WA_UNOFFICIAL_DISABLED'));
      expect(html).not.toContain('WA_UNOFFICIAL_DISABLED');
      expect(html).not.toContain('ignored server text');
      state.list.error = new ApiError(500, 'SOMETHING_NEW', 'raw message');
      expect(out(<DevicesScreen />)).toContain(at('errors.generic'));
    });
  });

  describe(`state badge (${locale})`, () => {
    it('has words for all eight states and for an unknown one', () => {
      for (const s of [
        'created',
        'awaiting_qr',
        'awaiting_pairing_code',
        'connecting',
        'connected',
        'disconnected',
        'logged_out',
        'error',
        'future_state',
      ]) {
        const html = out(<StateBadge state={s} />);
        expect(html).toContain(at(`state.${s === 'future_state' ? 'unknown' : s}`));
      }
    });
  });

  describe(`connect wizard steps (${locale})`, () => {
    it('step 1 shows the notice with three unticked boxes, in the canonical English or the translation', () => {
      const html = out(
        <NoticeStep
          version={PERSONAL_WA_NOTICE_VERSION}
          acks={NO_ACKS}
          onAcks={() => undefined}
          busy={false}
          error={null}
        />,
      );
      expect((html.match(/type="checkbox"/g) ?? []).length).toBe(3);
      expect(html).not.toContain('checked=""');
      expect(html).toContain('data-testid="must-tick"');
      for (const item of PERSONAL_WA_NOTICE_ITEMS) {
        const key = `notice.texts.v2026_10_07_1.items.${item.id}`;
        expect(html).toContain(at(key).replace(/'/g, '&#x27;'));
      }
      const ticked = out(
        <NoticeStep
          version={PERSONAL_WA_NOTICE_VERSION}
          acks={tick(NO_ACKS, 0, true)}
          onAcks={() => undefined}
          busy={false}
          error={null}
        />,
      );
      expect((ticked.match(/checked=""/g) ?? []).length).toBe(1);
    });

    it('the wizard opens on the notice when it was not accepted, with the accept button disabled', () => {
      const html = out(
        <ConnectWizard
          noticeVersion={PERSONAL_WA_NOTICE_VERSION}
          noticeAccepted={false}
          onClose={() => undefined}
        />,
      );
      expect(html).toContain('data-step="notice"');
      expect(html).toContain(at('common.reminder'));
      expect(html).toContain(at('common.unofficial'));
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*<\/button>/);
    });

    it('the wizard skips the notice when accepted, and a reconnect opens on the link step', () => {
      expect(
        out(<ConnectWizard noticeVersion={null} noticeAccepted onClose={() => undefined} />),
      ).toContain('data-step="number"');
      const html = out(
        <ConnectWizard
          existing={device({ connectionState: 'disconnected', status: 'disconnected' })}
          noticeVersion={null}
          noticeAccepted
          onClose={() => undefined}
        />,
      );
      expect(html).toContain('data-step="link"');
      expect(html).toContain('role="radiogroup"');
    });

    it('step 2 shows field messages only after the first Continue', () => {
      const quiet = out(
        <NumberStep
          draft={EMPTY_DRAFT}
          onDraft={() => undefined}
          showProblems={false}
          error={null}
          existingHref={null}
        />,
      );
      expect(quiet).not.toContain(at('wizard.number.nameError.required'));
      const loud = out(
        <NumberStep
          draft={EMPTY_DRAFT}
          onDraft={() => undefined}
          showProblems
          error={null}
          existingHref={null}
        />,
      );
      expect(loud).toContain(at('wizard.number.nameError.required'));
      expect(loud).toContain(at('wizard.number.phoneError.empty'));
    });

    it('step 2 links to the existing number when the server says it exists', () => {
      const html = out(
        <NumberStep
          draft={EMPTY_DRAFT}
          onDraft={() => undefined}
          showProblems
          error={{ text: 'x', fieldErrors: [], plan: false, relinkable: false }}
          existingHref={`/devices/${D2}`}
        />,
      );
      expect(html).toContain(`href="/devices/${D2}"`);
    });

    it('step 3 offers QR or code; the code is disabled without a country code and carries the take-over warning', () => {
      const noCode = out(
        <MethodChoice
          phoneLabel="+9176"
          method="qr"
          onMethod={() => undefined}
          codeAllowed={false}
        />,
      );
      expect(noCode).toContain('data-testid="need-country-code"');
      expect(noCode).toMatch(/<input[^>]*type="radio"[^>]*disabled=""/);
      const code = out(
        <MethodChoice
          phoneLabel="+917690059356"
          method="code"
          onMethod={() => undefined}
          codeAllowed
        />,
      );
      expect(code).toContain('data-testid="code-warning"');
      expect(code).toContain(at('wizard.link.someoneElse').replace(/'/g, '&#x27;'));
    });

    it('QR panel draws the code, runs the countdown and never prints the QR string', () => {
      const html = out(
        <QrPanel
          qr={FAKE_QR}
          qrAgeMs={5000}
          receivedAt={1000}
          now={6000}
          deadlineMs={91_000}
          linking={false}
        />,
      );
      expect(html).toContain('<svg');
      expect(html).toContain('data-testid="qr-ring"');
      expect(html).toContain('data-seconds="10"');
      expect(html).toContain('data-testid="qr-expires"');
      expect(html).not.toContain(FAKE_QR);
      expect(html).not.toContain('SECRETQRPAYLOAD');
    });

    it('QR panel waits for the first code, and dims while WhatsApp is linking', () => {
      const wait = out(
        <QrPanel
          qr={null}
          qrAgeMs={null}
          receivedAt={0}
          now={0}
          deadlineMs={null}
          linking={false}
        />,
      );
      expect(wait).toContain(at('wizard.link.reading'));
      expect(wait).not.toContain('data-testid="qr-ring"');
      const linking = out(
        <QrPanel qr={FAKE_QR} qrAgeMs={0} receivedAt={0} now={0} deadlineMs={null} linking />,
      );
      expect(linking).toContain(at('wizard.link.linking'));
      expect(linking).not.toContain('data-testid="qr-ring"');
    });

    it('code panel shows XXXX-XXXX with a copy button, the validity and the steps', () => {
      const html = out(
        <CodePanel
          code="abcd1234"
          codeExpiresIn={180}
          receivedAt={0}
          now={30_000}
          linking={false}
          copied={false}
          copyFailed={false}
          onCopy={() => undefined}
        />,
      );
      expect(html).toContain('ABCD-1234');
      expect(html).toContain(at('wizard.link.copy'));
      expect(html).toContain('2:30');
      const done = out(
        <CodePanel
          code="abcd1234"
          codeExpiresIn={180}
          receivedAt={0}
          now={0}
          linking={false}
          copied
          copyFailed={false}
          onCopy={() => undefined}
        />,
      );
      expect(done).toContain(at('wizard.link.copied'));
      const failed = out(
        <CodePanel
          code="abcd1234"
          codeExpiresIn={180}
          receivedAt={0}
          now={0}
          linking={false}
          copied={false}
          copyFailed
          onCopy={() => undefined}
        />,
      );
      expect(failed).toContain(at('wizard.link.copyFailed'));
    });

    it('the progress strip marks where the link is', () => {
      const html = out(<ProgressStrip phase="linking" />);
      expect(html).toContain('data-step="shown" data-status="done"');
      expect(html).toContain('data-step="scanned" data-status="current"');
      expect(html).toContain('data-step="ready" data-status="todo"');
    });

    it('step 4 shows connected, and each ending in words without saying banned', () => {
      const ok = out(
        <ResultStep
          outcome={{ kind: 'connected' }}
          phoneLabel="+917690059356"
          warmerHref="/warmer"
          inboxHref="/inbox"
        />,
      );
      expect(ok).toContain('data-testid="result-connected"');
      expect(ok).toContain('href="/warmer"');
      expect(ok).toContain('href="/inbox"');
      for (const failure of [
        'timedOut',
        'phoneOffline',
        'loggedOut',
        'replaced',
        'mismatch',
        'limit',
        'proxy',
        'service',
        'failed',
      ] as const) {
        const html = out(
          <ResultStep
            outcome={{ kind: 'failure', failure, reason: null }}
            phoneLabel=""
            warmerHref="/warmer"
            inboxHref="/inbox"
          />,
        );
        expect(html).toContain(`data-testid="result-${failure}"`);
        expect(html).toContain(at(`wizard.result.${failure}Title`));
        expect(html.toLowerCase()).not.toContain('banned');
      }
    });
  });

  describe(`device detail and dialogs (${locale})`, () => {
    const detail = (over: Partial<PersonalDeviceDetail> = {}): PersonalDeviceDetail => ({
      ...device(),
      lastError: null,
      warmerConfigured: false,
      hasSession: true,
      ...over,
    });

    it('detail shows status, last seen, the locked number while a session exists and no proxy section', () => {
      state.detail.data = detail();
      state.list.data = list([device()]);
      const html = out(<DeviceDetailScreen id={D1} />);
      expect(html).toContain('Sales line');
      expect(html).toContain(at('state.connected'));
      expect(html).toContain(at('detail.numberLocked'));
      expect(html).toContain(at('detail.dangerTitle'));
      expect(html.toLowerCase()).not.toContain('proxy');
      expect(html).toContain('href="/warmer"');
    });

    it('detail offers to link again and edit the number when no session exists', () => {
      state.detail.data = detail({
        connectionState: 'logged_out',
        status: 'disconnected',
        stateReason: 'forbidden',
        hasSession: false,
      });
      state.list.data = list([]);
      const html = out(<DeviceDetailScreen id={D1} />);
      expect(html).toContain(at('list.action.relink'));
      expect(html).toContain(at('reason.forbidden'));
      expect(html).not.toContain(at('detail.numberLocked'));
    });

    it('detail without permissions has no edit button and no danger zone', () => {
      state.can = new Set(['wa.devices.read']);
      state.detail.data = detail();
      state.list.data = list([]);
      const html = out(<DeviceDetailScreen id={D1} />);
      expect(html).not.toContain(at('detail.dangerTitle'));
      expect(html).not.toContain(`>${at('detail.save')}<`);
    });

    it('detail loading, not found and failure states', () => {
      state.detail = { data: undefined, isPending: true, isError: false, error: null };
      expect(out(<DeviceDetailScreen id={D1} />)).toContain(at('detail.loading'));
      state.detail = {
        data: undefined,
        isPending: false,
        isError: true,
        error: new ApiError(404, 'NOT_FOUND', 'x'),
      };
      expect(out(<DeviceDetailScreen id={D1} />)).toContain(at('detail.notFound'));
    });

    it('the disconnect and delete dialogs explain what happens, and delete says the chats stay', () => {
      const d = device();
      const dis = out(
        <DisconnectDialog device={d} onClose={() => undefined} onDone={() => undefined} />,
      );
      expect(dis).toContain(at('dialog.disconnect.confirm'));
      expect(dis).toContain(at('dialog.disconnect.message'));
      const del = out(
        <DeleteDialog device={d} onClose={() => undefined} onDone={() => undefined} />,
      );
      expect(del).toContain(at('dialog.delete.message'));
      expect(del).toContain(at('dialog.delete.confirm'));
      const ren = out(
        <RenameDialog device={d} onClose={() => undefined} onDone={() => undefined} />,
      );
      expect(ren).toContain('value="Sales line"');
    });

    it('the notice page shows the standing and the read-only statements', () => {
      state.notice.data = {
        version: PERSONAL_WA_NOTICE_VERSION,
        accepted: true,
        acceptedAt: '2026-10-07T09:00:00.000Z',
      };
      const html = out(<NoticeScreen />);
      expect(html).toContain('data-testid="notice-standing"');
      expect(html).toContain(at('notice.pageTitle'));
      expect(html).not.toContain('type="checkbox"');
      state.notice.data = {
        version: PERSONAL_WA_NOTICE_VERSION,
        accepted: false,
        acceptedAt: null,
      };
      expect(out(<NoticeScreen />)).toContain(at('notice.notAccepted'));
    });
  });
}

describe('right-to-left', () => {
  it('Arabic renders Arabic text and keeps phone numbers left-to-right', () => {
    state.list.data = list([device()]);
    const html = render(<DevicesScreen />, 'ar');
    expect(html).toContain('أرقام واتساب الشخصية');
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain('Personal WhatsApp numbers');
  });
});

describe('pairing secrets', () => {
  it('a pairing answer is typed with a QR and a code, and the screens only draw them', () => {
    const answer: DevicePairing = {
      attempt: D1,
      method: 'qr',
      state: 'awaiting_qr',
      reason: null,
      label: 'Qr generated',
      progress: 30,
      qr: FAKE_QR,
      qrAgeMs: 0,
      code: null,
      codeExpiresIn: null,
      startedAt: '2026-10-07T10:00:00.000Z',
      deadlineAt: '2026-10-07T10:01:30.000Z',
      startedByMe: true,
    };
    expect(answer.qr).toBe(FAKE_QR);
  });
});
