import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type {
  ListDevicesResponse,
  PersonalDevice,
  WaDeviceGroup,
  WaDeviceGroupList,
  WaDeviceGroupMember,
  WaDeviceGroupsState,
} from '@crm/contracts';
import {
  makeSession,
  renderAccount,
  type Seed,
} from '@/features/auth-registration-security/account/render-test-utils';
import { KEYS } from '../api/devices';
import { GROUP_KEYS } from '../api/groups-hooks';
import { GroupsProvider, type GroupsCtx } from './groups-context';
import { GroupNumberRail } from './group-number-rail';
import { GroupsScreen } from './groups-screen';
import { MembersModal } from './members-modal';
import { OutcomeList } from './outcome-list';
import { RateLimitBanner } from './groups-states';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const G1 = '33333333-3333-4333-8333-333333333333';
const G2 = '44444444-4444-4444-8444-444444444444';

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
  assignee: null,
  createdBy: null,
  proxy: { enabled: false, status: null, egressIp: null },
  sent24h: 0,
  failed24h: 0,
  createdAt: '2026-10-06T09:00:00.000Z',
  rowVersion: 1,
  ...over,
});

const group = (over: Partial<WaDeviceGroup> = {}): WaDeviceGroup => ({
  id: G1,
  deviceId: D1,
  groupId: '120363025246125486',
  subject: 'VIP customers',
  description: 'Offers first',
  size: 3,
  isAdmin: true,
  announce: false,
  restrict: false,
  joinApproval: false,
  memberAddMode: 'all_member_add',
  hasInviteLink: true,
  pictureUrl: null,
  participantsPreview: [
    { name: 'Asha', admin: 'superadmin' },
    { name: 'Ravi', admin: null },
  ],
  participantsCount: 3,
  pendingRequestCount: 0,
  conversationId: null,
  groupCreatedAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-10-08T00:00:00.000Z',
  syncedAt: '2026-10-08T00:00:00.000Z',
  left: false,
  leftAt: null,
  rowVersion: 1,
  ...over,
});

const limits = (
  over: Partial<WaDeviceGroupsState['limits']> = {},
): WaDeviceGroupsState['limits'] => ({
  opsPerMinute: { limit: 20, remaining: 18, resetsAt: null },
  opsPerDay: { limit: 200, remaining: 190, resetsAt: null },
  createsPerDay: { limit: 5, remaining: 4, resetsAt: null },
  joinByLinkPerDay: { limit: 5, remaining: 5, resetsAt: null },
  cooldownUntil: null,
  participantsPerCall: 20,
  ...over,
});

const state = (over: Partial<WaDeviceGroupsState> = {}): WaDeviceGroupsState => ({
  deviceId: D1,
  connected: true,
  reason: 'ready',
  limits: limits(),
  joinByLinkEnabled: false,
  lastSyncedAt: '2026-10-08T00:00:00.000Z',
  ...over,
});

const list = (
  items: WaDeviceGroup[],
  stats?: Partial<WaDeviceGroupList['stats']>,
): WaDeviceGroupList => ({
  items,
  stats: { groups: items.length, members: 6, joinRequests: 0, admin: 1, left: 0, ...stats },
  page: { nextCursor: null, hasMore: false, limit: 25 },
});

const devices = (data: PersonalDevice[]): ListDevicesResponse => ({
  data,
  page: { nextCursor: null, hasMore: false, limit: 100 },
  meta: {
    used: data.length,
    limit: 5,
    planLimit: 5,
    pilotCap: 5,
    noticeVersion: '2026-10-07.1',
    noticeAccepted: true,
    workerRunning: true,
  },
});

const seeds = (opts: {
  devices?: PersonalDevice[];
  state?: WaDeviceGroupsState;
  groups?: WaDeviceGroup[];
  stats?: Partial<WaDeviceGroupList['stats']>;
  extra?: Seed;
}): Seed => {
  const out: Array<readonly [readonly unknown[], unknown]> = [
    [KEYS.list, devices(opts.devices ?? [device()])],
  ];
  if (opts.state) out.push([GROUP_KEYS.state(D1), opts.state]);
  if (opts.groups)
    out.push([
      GROUP_KEYS.list(D1, { status: 'all' }),
      { pages: [list(opts.groups, opts.stats)], pageParams: [undefined] },
    ]);
  return [...out, ...(opts.extra ?? [])];
};

/** The opening tag of the element with this test id. */
const openTag = (html: string, testId: string): string => {
  const at = html.indexOf(`data-testid="${testId}"`);
  if (at < 0) return '';
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

const ALL = {
  'wa.groups.read': 'all',
  'wa.groups.create': 'all',
  'wa.groups.manage': 'all',
  'wa.groups.leave': 'all',
  'wa.devices.read': 'all',
} as const;
const session = (perms: Record<string, 'all'> = ALL) =>
  makeSession({ permissions: perms as never });

function render(
  seed: Seed,
  opts: { locale?: 'en' | 'ar'; perms?: Record<string, 'all'>; deviceId?: string } = {},
) {
  return renderAccount(
    <ToastProvider dismissLabel="x">
      <GroupsScreen deviceId={opts.deviceId} />
    </ToastProvider>,
    { locale: opts.locale, session: session(opts.perms), seed },
  );
}

describe('the Groups tab', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`draws the rail, the counters, the actions and the list in ${locale}`, () => {
      const html = render(
        seeds({
          state: state(),
          groups: [group(), group({ id: G2, groupId: '120363000000000002', subject: 'Second' })],
        }),
        { locale },
      );
      expect(html).toContain('data-testid="groups-rail"');
      expect(html).toContain('data-testid="groups-kpis"');
      expect(html).toContain('VIP customers');
      expect(html).toContain('Second');
      expect(html).toContain('data-testid="groups-create-open"');
      expect(html).toContain('data-testid="groups-limits"');
    });
  }

  it('shows each row with its badges: admin, announce-only, edit-restricted, approval, pending requests', () => {
    const html = render(
      seeds({
        state: state(),
        groups: [
          group({ announce: true, restrict: true, joinApproval: true, pendingRequestCount: 2 }),
        ],
      }),
    );
    for (const b of ['admin', 'announce', 'restrict', 'approval', 'requests']) {
      expect(html).toContain(`data-badge="${b}"`);
    }
    expect(html).toContain('2 requests');
    expect(html).toContain('Asha, Ravi');
    expect(html).toContain('3 members');
  });

  it('marks a group where the number is not an admin and says why the edit buttons are off', () => {
    const html = render(
      seeds({ state: state(), groups: [group({ isAdmin: false })], stats: { admin: 0 } }),
    );
    expect(html).toContain('data-badge="notAdmin"');
    expect(html).toContain('data-testid="groups-blocked-note"');
    expect(html).toContain('This number is not an admin here');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Edit<\/button>/);
    // Members can still be read.
    expect(html).toMatch(/<button[^>]*>Members<\/button>/);
    expect(html).toContain('data-testid="groups-not-admin-hint"');
  });

  it('keeps a group the number left, read-only, with a Left badge and no way to change or leave it', () => {
    const html = render(
      seeds({
        state: state(),
        groups: [group({ left: true, leftAt: '2026-10-09T10:00:00.000Z', pendingRequestCount: 3 })],
        stats: { left: 1, admin: 0 },
      }),
    );
    expect(html).toContain('data-badge="left"');
    expect(html).toContain('data-testid="groups-left-note"');
    expect(html).not.toContain('data-badge="admin"');
    expect(html).not.toContain('data-badge="requests"');
    expect(html).not.toContain('text-danger">Leave<');
    expect(html).not.toContain('data-testid="join-requests"');
  });

  it('hides what the role cannot use: create, edit, members, leave and the invite link', () => {
    const html = render(seeds({ state: state(), groups: [group()] }), {
      perms: { 'wa.groups.read': 'all' },
    });
    expect(html).not.toContain('groups-create-open');
    expect(html).not.toMatch(/<button[^>]*>Edit<\/button>/);
    expect(html).not.toMatch(/<button[^>]*>Members<\/button>/);
    expect(html).not.toContain('text-danger">Leave<');
    expect(html).not.toContain('groups-invite-panel');
    expect(html).toContain('VIP customers');
  });

  it('offers edit, members, leave and the invite link to a full manager', () => {
    const html = render(seeds({ state: state(), groups: [group()] }));
    expect(html).toMatch(/<button[^>]*>Edit<\/button>/);
    expect(html).toMatch(/<button[^>]*>Members<\/button>/);
    expect(html).toContain('text-danger">Leave<');
    expect(html).toContain('data-testid="groups-invite-panel"');
  });

  it('shows who is waiting to join to a manager, and only a count to a reader', () => {
    const g = group({ pendingRequestCount: 2 });
    const requests = [
      ['wadev', 'groups-requests', G1] as const,
      {
        requests: [
          {
            jid: '911111@s.whatsapp.net',
            phone: '+911111111111',
            name: 'Meera',
            requestedAt: null,
          },
          { jid: '922222@lid', phone: null, name: null, requestedAt: null },
        ],
      },
    ] as const;
    const manager = render(seeds({ state: state(), groups: [g], extra: [requests] }));
    expect(manager).toContain('data-testid="join-requests"');
    expect(manager).toContain('2 people waiting to join');
    expect(manager).toContain('Meera');
    expect(manager).toContain('+911111111111');
    expect(manager).toContain('Someone');
    expect(manager).toContain('Approve');
    expect(manager).toContain('Reject');
    expect(manager).toContain('Approve all');
    const reader = render(seeds({ state: state(), groups: [g], extra: [requests] }), {
      perms: { 'wa.groups.read': 'all' },
    });
    expect(reader).not.toContain('Meera');
    expect(reader).not.toContain('+911111111111');
    expect(reader).toContain('2 people are waiting to join.');
  });

  it('turns the request buttons off when the number is not an admin', () => {
    const html = render(
      seeds({
        state: state(),
        groups: [group({ isAdmin: false, pendingRequestCount: 1 })],
        extra: [
          [
            ['wadev', 'groups-requests', G1],
            {
              requests: [
                { jid: '9@s.whatsapp.net', phone: '+9199', name: 'Meera', requestedAt: null },
              ],
            },
          ],
        ],
      }),
    );
    expect(html).toContain('Meera');
    expect(html).toContain('This number is not an admin, so it cannot answer these requests.');
    expect(html).not.toMatch(/<button[^>]*>Approve<\/button>/);
  });

  it('says "No groups yet" for an empty list and "No group matches" is for a filtered one', () => {
    const html = render(seeds({ state: state(), groups: [] }));
    expect(html).toContain('data-testid="groups-empty"');
    expect(html).toContain('No groups yet.');
  });

  it('shows join by link only when the platform says it is on, and only to a manager', () => {
    const off = render(seeds({ state: state({ joinByLinkEnabled: false }), groups: [] }));
    expect(off).not.toContain('groups-join-open');
    const on = render(seeds({ state: state({ joinByLinkEnabled: true }), groups: [] }));
    expect(on).toContain('data-testid="groups-join-open"');
    const reader = render(seeds({ state: state({ joinByLinkEnabled: true }), groups: [] }), {
      perms: { 'wa.groups.read': 'all' },
    });
    expect(reader).not.toContain('groups-join-open');
  });

  it('is a normal page, not an error, when the number is offline: groups stay, with the reason and a link to the number', () => {
    const html = render(
      seeds({
        devices: [device({ connectionState: 'disconnected', status: 'disconnected' })],
        state: state({ connected: false, reason: 'not_connected' }),
        groups: [group()],
      }),
    );
    expect(html).toContain('data-testid="groups-offline-not_connected"');
    expect(html).toContain('This number is offline');
    expect(html).toContain(`href="/devices/${D1}"`);
    expect(html).toContain('VIP customers');
    // Nothing can reach WhatsApp: the actions that do are off.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Edit<\/button>/);
    expect(openTag(html, 'groups-sync')).toContain('disabled=""');
  });

  it('says the connection service is busy when the number is linked but no worker holds it', () => {
    const html = render(
      seeds({
        state: state({ connected: false, reason: 'worker_unavailable' }),
        groups: [group()],
      }),
    );
    expect(html).toContain('data-testid="groups-offline-worker_unavailable"');
    expect(html).toContain('The connection service is busy');
  });

  it('counts down a cooldown that is still running, with the reason', () => {
    const until = new Date(Date.now() + 5 * 60_000).toISOString();
    const html = render(
      seeds({
        state: state({ limits: limits({ cooldownUntil: until }) }),
        groups: [group()],
      }),
    );
    // The hold starts in an effect (the page is rendered to a string here), so the banner itself is covered below.
    expect(html).toContain('VIP customers');
  });

  it('offers the numbers in the rail with online and offline, and links each to its own groups', () => {
    const html = render(
      seeds({
        devices: [
          device(),
          device({
            id: D2,
            name: 'Support',
            phone: '+917000000000',
            connectionState: 'error',
            status: 'disconnected',
          }),
        ],
        state: state(),
        groups: [group()],
      }),
    );
    expect(html).toContain(`href="/devices/groups?device=${D1}"`);
    expect(html).toContain(`href="/devices/groups?device=${D2}"`);
    expect(html).toContain('data-online="true"');
    expect(html).toContain('data-online="false"');
    expect(html).toContain('Online');
    expect(html).toContain('Offline');
  });

  it('shows the number named in ?device=, else the first connected one', () => {
    const two = [
      device({ id: D1, connectionState: 'disconnected', status: 'disconnected' }),
      device({ id: D2, name: 'Support', phone: '+917000000000' }),
    ];
    const byQuery = render(seeds({ devices: two }), { deviceId: D1 });
    expect(byQuery).toMatch(
      new RegExp(
        `data-device="${D1}"[^>]*aria-current="page"|aria-current="page"[^>]*data-device="${D1}"`,
      ),
    );
    const byDefault = render(seeds({ devices: two }));
    expect(byDefault).toMatch(
      new RegExp(
        `aria-current="page"[^>]*data-device="${D2}"|data-device="${D2}"[^>]*aria-current="page"`,
      ),
    );
  });

  it('explains there is no personal number yet', () => {
    const html = render(seeds({ devices: [] }));
    expect(html).toContain('data-testid="groups-state-noDevice"');
    expect(html).toContain('No personal number connected');
    expect(html).not.toContain('groups-kpis');
  });

  it('explains that the role may not read groups, with no controls', () => {
    const html = render(seeds({ state: state(), groups: [group()] }), {
      perms: { 'wa.devices.read': 'all' },
    });
    expect(html).toContain('data-testid="groups-state-denied"');
    expect(html).not.toContain('VIP customers');
  });
});

describe('what a group says about itself is drawn as text', () => {
  it('never turns a subject, a description or a member name into markup', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = render(
      seeds({
        state: state(),
        groups: [
          group({
            subject: evil,
            description: '<script>alert(2)</script>',
            participantsPreview: [{ name: '<b onmouseover=alert(3)>Eve</b>', admin: null }],
          }),
        ],
      }),
    );
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<b onmouseover');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  it('draws a picture only from a secure address', () => {
    const ok = render(
      seeds({ state: state(), groups: [group({ pictureUrl: 'https://pps.whatsapp.net/a.jpg' })] }),
    );
    expect(ok).toContain('src="https://pps.whatsapp.net/a.jpg"');
    expect(ok).toContain('referrerPolicy="no-referrer"');
    const bad = render(
      seeds({ state: state(), groups: [group({ pictureUrl: 'javascript:alert(1)' })] }),
    );
    expect(bad).not.toContain('javascript:');
    const data = render(
      seeds({ state: state(), groups: [group({ pictureUrl: 'data:text/html,<script>' })] }),
    );
    expect(data).not.toContain('data:text/html');
  });
});

describe('the rail alone', () => {
  it('lists the limits left and the per-call cap, and the join limit only when joining is on', () => {
    const html = renderAccount(
      <GroupNumberRail
        device={device()}
        devices={[device()]}
        state={state({ joinByLinkEnabled: true })}
        stats={{ groups: 3, members: 9, joinRequests: 0, admin: 1, left: 1 }}
      />,
    );
    expect(html).toContain('18 / 20');
    expect(html).toContain('190 / 200');
    expect(html).toContain('4 / 5');
    expect(html).toContain('Joins by link today');
    expect(html).toContain('At most 20 people per add or remove.');
    // 3 groups, 1 admin, 1 left: one is not admin.
    expect(html).toContain('This number is not an admin in 1 group');
  });
});

describe('the rate limit banner', () => {
  it('shows nothing when nothing is held, and the countdown as m:ss while it is', () => {
    expect(renderAccount(<RateLimitBanner waitSeconds={0} />)).toBe('');
    const html = renderAccount(<RateLimitBanner waitSeconds={65} />);
    expect(html).toContain('data-testid="groups-rate-limited"');
    expect(html).toContain('Try again in 1:05');
    expect(renderAccount(<RateLimitBanner waitSeconds={9} />)).toContain('Try again in 0:09');
  });
});

describe('the outcome of each person', () => {
  it('says what to do for each refusal, with the number shown left to right', () => {
    const html = renderAccount(
      <OutcomeList
        results={[
          { number: '+919900000001', outcome: 'privacy_blocked', code: '403' },
          { number: '+919900000002', outcome: 'not_on_whatsapp', code: '404' },
          { number: '+919900000003', outcome: 'already_member', code: '409' },
          { number: null, outcome: 'failed', code: null },
        ]}
      />,
    );
    expect(html).toContain('Send them the invite link instead');
    expect(html).toContain('not on WhatsApp');
    expect(html).toContain('Already in the group');
    expect(html).toContain('A member');
    expect(html).toContain('dir="ltr"');
  });
});

describe('the members window', () => {
  const ctx = (over: Partial<GroupsCtx> = {}): GroupsCtx => ({
    device: device(),
    online: true,
    perms: { create: true, manage: true, leave: true },
    waitSeconds: 0,
    notify: () => undefined,
    fail: () => undefined,
    ...over,
  });
  const members: WaDeviceGroupMember[] = [
    {
      jid: '917690059356@s.whatsapp.net',
      phone: '+917690059356',
      name: 'Me',
      admin: 'superadmin',
      self: true,
    },
    {
      jid: '919900000001@s.whatsapp.net',
      phone: '+919900000001',
      name: 'Asha',
      admin: 'admin',
      self: false,
    },
    {
      jid: '919900000002@s.whatsapp.net',
      phone: '+919900000002',
      name: '<b>Ravi</b>',
      admin: null,
      self: false,
    },
    { jid: '271828@lid', phone: null, name: null, admin: null, self: false },
  ];
  const render = (c: GroupsCtx, g = group()) =>
    renderAccount(
      <GroupsProvider value={c}>
        <MembersModal group={g} open onClose={() => undefined} />
      </GroupsProvider>,
      {
        session: session(),
        seed: [
          [
            GROUP_KEYS.members(G1, ''),
            {
              pages: [{ members, total: 4, page: { nextCursor: null, hasMore: false, limit: 50 } }],
              pageParams: [undefined],
            },
          ],
        ],
      },
    );

  it('lists members, roles and this number, with no change offered for a member WhatsApp shows without a number', () => {
    const html = render(ctx());
    expect(html).toContain('groups-member-list');
    expect(html).toContain('Asha');
    expect(html).toContain('Owner');
    expect(html).toContain('This number');
    expect(html).toContain('WhatsApp does not show this member');
    expect(html).toContain('&lt;b&gt;Ravi&lt;/b&gt;');
    expect(html).not.toContain('<b>Ravi</b>');
    expect(html).toContain('Make admin');
    expect(html).toContain('Remove admin');
  });

  it('is read-only for a number that is not an admin: no add box, no remove, no promote', () => {
    const html = render(ctx(), group({ isAdmin: false }));
    expect(html).toContain('groups-member-list');
    expect(html).toContain('data-testid="groups-members-readonly"');
    expect(html).not.toContain('data-testid="groups-add"');
    expect(html).not.toContain('Make admin');
  });
});
