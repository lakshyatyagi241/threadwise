import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { WabaConnection, WabaGroup, WabaGroupList, WabaGroupsState } from '@crm/contracts';
import {
  makeSession,
  renderAccount,
  type Seed,
} from '@/features/auth-registration-security/account/render-test-utils';
import { resolveNav } from '@/features/_registry/resolve';
import { nav } from '../nav';
import { GROUP_KEYS } from '../api/groups-hooks';
import { KEYS } from '../api/hooks';
import { GroupsScreen } from './groups-screen';
import { RemoveNumberMessage } from './remove-number-warning';
import { blockedView, editPatch, pickAccount, toggleSelected } from './groups-model';

const NUMBER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const connection = (over: Partial<WabaConnection> = {}): WabaConnection => ({
  id: NUMBER,
  provider: 'meta',
  status: 'connected',
  isPrimary: true,
  displayLabel: 'Support line',
  phoneNumber: '+919112290122',
  verifiedName: 'Acme',
  wabaId: 'W1',
  phoneNumberId: 'P1',
  businessId: null,
  qualityRating: 'GREEN',
  messagingLimitTier: 'TIER_1K',
  platformType: 'CLOUD_API',
  nameStatus: 'APPROVED',
  codeVerificationStatus: 'VERIFIED',
  coexistence: false,
  inboundWired: true,
  inboundCheckedAt: null,
  connectedVia: 'manual',
  hasToken: true,
  tokenExpiresAt: null,
  lastError: null,
  connectedAt: null,
  lastHealthAt: null,
  rowVersion: 1,
  ...over,
});

const group = (over: Partial<WabaGroup> = {}): WabaGroup => ({
  id: '33333333-3333-4333-8333-333333333333',
  groupId: 'G1',
  subject: 'VIP customers',
  description: null,
  inviteLink: 'https://chat.whatsapp.com/abc',
  awaitingInviteLink: false,
  joinApprovalMode: 'auto_approve',
  participantCount: 3,
  suspended: false,
  pendingJoinRequestCount: 0,
  pendingJoinRequests: [],
  lastError: null,
  syncedAt: null,
  createdAt: '2026-10-08T00:00:00.000Z',
  rowVersion: 1,
  ...over,
});

const state = (over: Partial<WabaGroupsState> = {}): WabaGroupsState => ({
  eligible: true,
  reason: 'eligible',
  provider: 'meta',
  officialBusinessAccount: true,
  ...over,
});

const list = (items: WabaGroup[], stats?: Partial<WabaGroupList['stats']>): WabaGroupList => ({
  items,
  stats: { groups: items.length, members: 0, joinRequests: 0, suspended: 0, ...stats },
  page: { nextCursor: null, hasMore: false, limit: 25 },
});

const seeds = (opts: {
  numbers?: WabaConnection[];
  state?: WabaGroupsState;
  groups?: WabaGroup[];
  stats?: Partial<WabaGroupList['stats']>;
}): Seed => {
  const out: Array<[readonly unknown[], unknown]> = [
    [KEYS.list, { items: opts.numbers ?? [connection()] }],
  ];
  if (opts.state) out.push([GROUP_KEYS.state(NUMBER), opts.state]);
  if (opts.groups)
    out.push([
      GROUP_KEYS.list(NUMBER),
      { pages: [list(opts.groups, opts.stats)], pageParams: [undefined] },
    ]);
  return out;
};

const ALL = {
  'waba.groups.read': 'all',
  'waba.groups.create': 'all',
  'waba.groups.manage': 'all',
  'waba.groups.delete': 'all',
} as const;
const session = (perms: Record<string, 'all'> = ALL) =>
  makeSession({ permissions: perms as never });

function render(
  seed: Seed,
  opts: { locale?: 'en' | 'ar'; perms?: Record<string, 'all'>; accountId?: string } = {},
) {
  return renderAccount(
    <ToastProvider dismissLabel="x">
      <GroupsScreen accountId={opts.accountId} />
    </ToastProvider>,
    { locale: opts.locale, session: session(opts.perms), seed },
  );
}

describe('the Groups screen', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`draws the rail, the four counters, the create form and the list in ${locale}`, () => {
      const html = render(
        seeds({
          state: state(),
          groups: [group(), group({ id: '4444', groupId: 'G2', subject: 'Second' })],
          stats: { groups: 2, members: 6, joinRequests: 1, suspended: 0 },
        }),
        { locale },
      );
      expect(html).toContain('data-testid="groups-kpis"');
      expect(html).toContain('VIP customers');
      expect(html).toContain('id="wg-subject"');
      expect(html).toContain('maxLength="128"');
      expect(html).toContain('maxLength="2048"');
      expect(html).toContain('value="approval_required"');
      // The invite link box stays left to right, also in Arabic.
      expect(html).toMatch(/<code dir="ltr"[^>]*>https:\/\/chat\.whatsapp\.com\/abc<\/code>/);
    });
  }

  it('says the invite link is being created while Meta has not sent it', () => {
    const html = render(
      seeds({
        state: state(),
        groups: [group({ inviteLink: null, awaitingInviteLink: true })],
      }),
    );
    expect(html).toContain('Invite link is being created by WhatsApp');
    expect(html).not.toContain('chat.whatsapp.com');
  });

  it('shows the suspended line, the approval tag, "No members" and "Untitled group"', () => {
    const html = render(
      seeds({
        state: state(),
        groups: [
          group({
            subject: null,
            suspended: true,
            participantCount: 0,
            joinApprovalMode: 'approval_required',
          }),
        ],
        stats: { suspended: 1 },
      }),
    );
    expect(html).toContain('Untitled group');
    expect(html).toContain('No members');
    expect(html).toContain('approval required');
    expect(html).toContain('WhatsApp has suspended this group');
  });

  it('shows who is waiting to join to a manager, and only a count to a reader', () => {
    const g = group({
      pendingJoinRequestCount: 2,
      pendingJoinRequests: [
        { id: 'j1', waId: '911111', createdAt: '1' },
        { id: 'j2', waId: '922222', createdAt: null },
      ],
    });
    const manager = render(seeds({ state: state(), groups: [g] }));
    expect(manager).toContain('Waiting to join');
    expect(manager).toContain('911111');
    expect(manager).toContain('Approve');
    expect(manager).toContain('Reject');
    // A reader never receives the numbers from the API; the screen shows the count only.
    const reader = render(
      seeds({
        state: state(),
        groups: [{ ...g, pendingJoinRequests: [] }],
      }),
      { perms: { 'waba.groups.read': 'all' } },
    );
    expect(reader).not.toContain('911111');
    expect(reader).not.toContain('Waiting to join');
    expect(reader).toContain('2 people are waiting to join');
  });

  it('hides the controls the role cannot use: create, edit, members, delete, new link', () => {
    const html = render(seeds({ state: state(), groups: [group()] }), {
      perms: { 'waba.groups.read': 'all' },
    });
    expect(html).not.toContain('Create a group');
    expect(html).not.toMatch(/<button[^>]*>Edit<\/button>/);
    expect(html).not.toMatch(/<button[^>]*>Members<\/button>/);
    expect(html).not.toContain('text-danger">Delete<');
    expect(html).not.toMatch(/<button[^>]*>New link<\/button>/);
    expect(html).toContain('Refresh');
    expect(html).toContain('Copy');
  });

  it('offers edit, members, delete and new link to a full manager', () => {
    const html = render(seeds({ state: state(), groups: [group()] }));
    expect(html).toMatch(/<button[^>]*>Edit<\/button>/);
    expect(html).toMatch(/<button[^>]*>Members<\/button>/);
    expect(html).toMatch(/<button[^>]*>New link<\/button>/);
    expect(html).toContain('text-danger">Delete<');
    expect(html).toContain('Create group');
  });

  it('says "No groups yet" for an empty list', () => {
    const html = render(seeds({ state: state(), groups: [] }));
    expect(html).toContain('No groups yet. Create one above to get started.');
  });

  it('is a normal page, not an error, when the number is not eligible: no controls, with the way out', () => {
    const html = render(seeds({ state: state({ eligible: false, reason: 'not_eligible' }) }));
    expect(html).toContain('data-testid="groups-state-notEligible"');
    expect(html).toContain('This number cannot use groups yet');
    expect(html).toContain('Official Business Accounts');
    expect(html).toContain('Check again');
    expect(html).toContain('Not eligible');
    expect(html).not.toContain('Create a group');
    expect(html).not.toContain('groups-kpis');
  });

  it('explains a number on another provider and a number without a token, with no controls', () => {
    const unsupported = render(
      seeds({
        state: state({ eligible: false, reason: 'provider_unsupported', provider: 'interakt' }),
      }),
    );
    expect(unsupported).toContain('data-testid="groups-state-providerUnsupported"');
    expect(unsupported).not.toContain('Create a group');
    const noToken = render(
      seeds({ state: state({ eligible: false, reason: 'missing_credentials' }) }),
    );
    expect(noToken).toContain('data-testid="groups-state-missingCredentials"');
  });

  it('keeps the controls and adds a line when Meta could not be asked', () => {
    const html = render(seeds({ state: state({ reason: 'check_failed' }), groups: [group()] }));
    expect(html).toContain('could not be asked');
    expect(html).toContain('Create a group');
  });

  it('says no number is connected, and offers the connect page', () => {
    const html = render(seeds({ numbers: [] }));
    expect(html).toContain('data-testid="groups-state-noNumber"');
    expect(html).toContain('No WhatsApp Business number connected');
    expect(html).toContain('href="/channels/whatsapp"');
  });

  it('ignores a disconnected number', () => {
    const html = render(seeds({ numbers: [connection({ status: 'disconnected' })] }));
    expect(html).toContain('No WhatsApp Business number connected');
  });

  it('shows the number switcher only with two or more connected numbers, and follows ?account=', () => {
    const two = [
      connection(),
      connection({ id: OTHER, displayLabel: 'Sales line', phoneNumber: '+919000000001' }),
    ];
    const single = render(seeds({ state: state(), groups: [] }));
    expect(single).not.toContain('Sales line');
    const html = render([...seeds({ numbers: two, state: state(), groups: [] })], {
      accountId: NUMBER,
    });
    expect(html).toContain('Sales line');
    expect(html).toContain(`href="/waba-groups?account=${OTHER}"`);
    expect(html).toContain('aria-current="page"');
  });

  it('draws the rail note about invite-only groups and the cost per member, and no capacity numbers (D9)', () => {
    const html = render(seeds({ state: state(), groups: [] }));
    expect(html).toContain('Groups are invite-only');
    expect(html).toContain('A message to 100 members costs 100 sends');
    expect(html).not.toMatch(/maximum of \d+ members|up to \d+ members|10,000/i);
  });
});

describe('the Groups messages', () => {
  const load = (loc: string) =>
    JSON.parse(
      readFileSync(
        resolve(__dirname, `../../../../messages/${loc}/whatsapp-cloud-api-waba.groups.json`),
        'utf8',
      ),
    ) as Record<string, unknown>;
  const leaves = (o: unknown, prefix = ''): string[] =>
    typeof o === 'object' && o !== null
      ? Object.entries(o).flatMap(([k, v]) => leaves(v, `${prefix}${prefix ? '.' : ''}${k}`))
      : [prefix];

  it('has every English key in Arabic and nothing extra', () => {
    expect(leaves(load('ar')).sort()).toEqual(leaves(load('en')).sort());
  });
});

describe('the menu entry', () => {
  const entry = nav[0]!;
  const caps = (over: Partial<{ p: string[]; f: string[] | null; c: string[] | null }> = {}) => ({
    permissions: new Set(over.p ?? ['waba.groups.read']),
    planFeatures: over.f === null ? null : new Set(over.f ?? ['waba_groups']),
    channels: over.c === null ? null : new Set(over.c ?? ['waba']),
  });

  it('is shown in Campaigns for a role with the key, on a plan with the feature, with a connected number', () => {
    const r = resolveNav(nav, caps());
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'waba-groups', group: 'campaigns', locked: false });
  });

  it('is locked with the upgrade mark on a plan without waba_groups', () => {
    expect(resolveNav(nav, caps({ f: [] }))[0]?.locked).toBe(true);
  });

  it('is removed without a connected WhatsApp number, and without the permission', () => {
    expect(resolveNav(nav, caps({ c: [] }))).toHaveLength(0);
    expect(resolveNav(nav, caps({ p: [] }))).toHaveLength(0);
  });

  it('stays visible while the connected channels are unknown (a slow lookup hides nothing)', () => {
    expect(resolveNav(nav, caps({ c: null }))).toHaveLength(1);
  });

  it('declares exactly the gates of the spec', () => {
    expect(entry.gates).toEqual({
      permission: 'waba.groups.read',
      channel: 'waba',
      planFeature: 'waba_groups',
    });
  });
});

describe('the model helpers', () => {
  it('picks the requested connected number, else the first connected one', () => {
    const a = connection();
    const b = connection({ id: OTHER });
    const off = connection({ id: 'x', status: 'disconnected' });
    expect(pickAccount([off, a, b], OTHER)?.id).toBe(OTHER);
    expect(pickAccount([off, a, b], 'x')?.id).toBe(NUMBER);
    expect(pickAccount([off], undefined)).toBeNull();
  });

  it('maps reasons to blocked views', () => {
    expect(blockedView('eligible')).toBeNull();
    expect(blockedView('check_failed')).toBeNull();
    expect(blockedView('not_eligible')).toBe('notEligible');
    expect(blockedView('provider_unsupported')).toBe('providerUnsupported');
    expect(blockedView('not_connected')).toBe('missingCredentials');
  });

  it('never selects more than 8 members', () => {
    let sel: string[] = [];
    for (let i = 0; i < 12; i++) sel = toggleSelected(sel, String(i));
    expect(sel).toHaveLength(8);
    expect(toggleSelected(sel, '3')).toHaveLength(7);
  });

  it('sends only what changed, and nothing for a blank name', () => {
    const cur = { subject: 'A', description: 'd' };
    expect(editPatch(cur, { subject: 'A', description: 'd' })).toBeNull();
    expect(editPatch(cur, { subject: '  ', description: 'x' })).toBeNull();
    expect(editPatch(cur, { subject: 'B', description: 'd' })).toEqual({ subject: 'B' });
    expect(editPatch(cur, { subject: 'A', description: '' })).toEqual({ description: '' });
  });
});

describe('the remove-number warning (decision D6)', () => {
  const show = (count: number | null, locale: 'en' | 'ar' = 'en') =>
    renderAccount(<RemoveNumberMessage id={NUMBER} message="Remove this number?" />, {
      locale,
      seed: count === null ? [] : [[['waba', 'group-count', NUMBER], { count }]],
    });

  it('names how many group records go with the number, and says the groups stay on WhatsApp', () => {
    const html = show(3);
    expect(html).toContain('Remove this number?');
    expect(html).toContain('3 group records');
    expect(html).toContain('stay on WhatsApp');
    expect(show(1)).toContain('1 group record ');
  });

  it('adds nothing for a number with no groups, or while the count is unknown', () => {
    expect(show(0)).not.toContain('remove-number-groups-warning');
    expect(show(null)).not.toContain('remove-number-groups-warning');
  });

  it('is in Arabic too', () => {
    expect(show(2, 'ar')).toContain('remove-number-groups-warning');
  });
});
