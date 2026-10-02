import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@crm/ui';
import { member, summary, team } from '../lib/fixtures';
import { readMessages } from '../lib/test-support';
import { InviteInvalid } from './accept-invite-form';
import { InviteDialog } from './invite-dialog';
import { MembersTable, type RowActions } from './members-table';
import { CopyField, ErrorNote } from './parts';
import { RoleFilter } from './role-filter';
import { TeamDialog, showsDevicePicker } from './team-dialog';
import { ApiError } from '@/lib/api/errors';
import { ERROR_CODES } from '@crm/contracts';

const html = (el: ReactElement, locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={readMessages(locale)}
      timeZone="UTC"
      now={new Date('2026-10-02T12:00:00Z')}
    >
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const noop = () => undefined;
const actions: RowActions = {
  busyId: null,
  onRole: noop,
  onReset: noop,
  onResend: noop,
  onRemove: noop,
};

function table(opts: {
  meTier: 'owner' | 'admin' | 'manager';
  members: ReturnType<typeof member>[];
  loading?: boolean;
  filtered?: boolean;
}) {
  const s = summary(opts.meTier);
  return html(
    <MembersTable
      members={opts.members}
      summary={s}
      loading={opts.loading ?? false}
      filtered={opts.filtered ?? false}
      canInvite={s.me.canInvite}
      actions={actions}
      onInvite={noop}
      hasMore={false}
      loadingMore={false}
      onLoadMore={noop}
    />,
  );
}

describe('RoleFilter', () => {
  it('shows the Reference pills with their counts and marks the active one', () => {
    const out = html(<RoleFilter summary={summary('owner')} value="agent" onChange={noop} />);
    for (const label of ['All members', 'Owners', 'Admins', 'Managers', 'Agents', 'Viewers']) {
      expect(out).toContain(label);
    }
    expect(out).not.toContain('Custom roles');
    expect(out).toMatch(
      /data-testid="role-filter-agent"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-testid="role-filter-agent"/,
    );
    expect(out).toContain('How roles work');
  });

  it('offers the custom-role pill when someone holds one', () => {
    const s = summary('owner');
    s.counts.custom = 3;
    expect(html(<RoleFilter summary={s} value="all" onChange={noop} />)).toContain('Custom roles');
  });

  it('renders in Arabic', () => {
    expect(
      html(<RoleFilter summary={summary('owner')} value="all" onChange={noop} />, 'ar'),
    ).toContain('جميع الأعضاء');
  });
});

describe('MembersTable', () => {
  const rows = [
    member(1, 'owner'),
    member(2, 'agent'),
    member(3, 'viewer', { status: 'pending', joinedAt: null }),
  ];

  it('gives an admin a role select, reset and remove, and resend for a pending invite', () => {
    const out = table({ meTier: 'admin', members: rows });
    expect(out).toContain('data-testid="role-select-person2@example.test"');
    expect(out).toContain('data-testid="reset-person2@example.test"');
    expect(out).toContain('data-testid="remove-person2@example.test"');
    expect(out).toContain('data-testid="resend-person3@example.test"');
    expect(out).not.toContain('data-testid="reset-person3@example.test"');
    // The owner row is a read-only badge with no actions.
    expect(out).not.toContain('role-select-person1@example.test');
    expect(out).not.toContain('remove-person1@example.test');
  });

  it('shows a manager only read-only badges: no select, no actions', () => {
    const out = table({ meTier: 'manager', members: rows });
    expect(out).not.toContain('role-select-');
    expect(out).not.toContain('data-testid="remove-');
    expect(out).not.toContain('data-testid="reset-');
    expect(out).toContain('Agent');
  });

  it('writes "pending" in italics for a member who has not joined, and a date for one who has', () => {
    const out = table({ meTier: 'admin', members: rows });
    expect(out).toContain('<span class="italic text-muted-foreground">pending</span>');
    expect(out).toContain('Oct 1, 2026');
  });

  it('shows the presence label with a status dot', () => {
    const out = table({ meTier: 'admin', members: [member(2, 'agent', { presence: 'busy' })] });
    expect(out).toContain('Busy');
    expect(out).toContain('bg-danger');
  });

  it('shows skeleton rows while loading', () => {
    const out = table({ meTier: 'admin', members: [], loading: true });
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('animate-pulse');
  });

  it('says no data was found, with an Invite member button when the caller can invite', () => {
    const out = table({ meTier: 'admin', members: [], filtered: true });
    expect(out).toContain('No data found');
    expect(out).toContain('No members match this view.');
    expect(out).toContain('Invite member');
    expect(table({ meTier: 'admin', members: [] })).toContain('No members found yet.');
  });

  it('leaves the Invite member button out for a caller who cannot invite', () => {
    expect(table({ meTier: 'manager', members: [] })).not.toContain('Invite member');
  });
});

describe('InviteDialog', () => {
  it('lists only the roles the caller may grant, Agent first', () => {
    const out = html(
      <InviteDialog open roles={summary('admin').roles} onClose={noop} onInvited={noop} />,
    );
    expect(out).toContain('Invite a teammate');
    expect(out).toContain('Full name');
    const options = [...out.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map((m) => m[1]);
    expect(options).toEqual([
      'Agent — handles assigned conversations only',
      'Manager — sees all teams, can assign + resolve',
      'Viewer — read-only',
    ]);
  });

  it('offers Admin and Owner to an owner', () => {
    const out = html(
      <InviteDialog open roles={summary('owner').roles} onClose={noop} onInvited={noop} />,
    );
    expect(out).toContain('Admin — full workspace access (no billing)');
    expect(out).toContain('Owner — everything including billing');
  });
});

describe('TeamDialog', () => {
  const device = (n: number) => ({ id: `d${n}`, label: `Line ${n}`, phone: `+1555000${n}` });

  it('shows the device picker only with more than one device', () => {
    expect(showsDevicePicker([])).toBe(false);
    expect(showsDevicePicker([device(1)])).toBe(false);
    expect(showsDevicePicker([device(1), device(2)])).toBe(true);
    const one = html(
      <TeamDialog open team={null} devices={[device(1)]} canDelete onClose={noop} />,
    );
    const two = html(
      <TeamDialog open team={null} devices={[device(1), device(2)]} canDelete onClose={noop} />,
    );
    expect(one).not.toContain('Limit to devices');
    expect(two).toContain('Limit to devices');
    expect(two).toContain('Line 2');
  });

  it('creates with the six swatches, the strategy list and no Delete button', () => {
    const out = html(<TeamDialog open team={null} devices={[]} canDelete onClose={noop} />);
    expect(out).toContain('Create a team');
    expect(out).toContain('Auto-assignment strategy');
    expect(out).toContain('Round robin — spread evenly');
    expect(out.match(/aria-label="Colour #/g)).toHaveLength(6);
    expect(out).not.toContain('data-testid="delete-team"');
  });

  it('edits with Delete when the caller may manage teams', () => {
    const t = team(1, { name: 'Sales', color: '#123456' });
    const out = html(<TeamDialog open team={t} devices={[]} canDelete onClose={noop} />);
    expect(out).toContain('Edit team');
    expect(out).toContain('value="Sales"');
    expect(out.match(/aria-label="Colour #/g)).toHaveLength(7);
    expect(out).toContain('data-testid="delete-team"');
    expect(
      html(<TeamDialog open team={t} devices={[]} canDelete={false} onClose={noop} />),
    ).not.toContain('data-testid="delete-team"');
  });
});

describe('parts', () => {
  it('shows the one-time link in a copyable box', () => {
    const out = html(<CopyField label="Link" value="https://app.test/accept-invite?token=abc" />);
    expect(out).toContain('value="https://app.test/accept-invite?token=abc"');
    expect(out).toContain('Copy');
  });

  it('points a plan-limit error at the plans page and keeps the request id for unexplained ones', () => {
    const limit = new ApiError(402, ERROR_CODES.PLAN_LIMIT_REACHED, 'x', undefined, [
      { path: 'limitValue', message: '5' },
    ]);
    const out = html(<ErrorNote error={limit} />);
    expect(out).toContain('href="/account/plans"');
    expect(out).toContain('5 seats');
    const odd = html(<ErrorNote error={new ApiError(500, 'INTERNAL', 'x', 'req-1')} />);
    expect(odd).toContain('req-1');
  });

  it('tells a visitor with a dead invite link to ask for a new one', () => {
    const out = html(<InviteInvalid />);
    expect(out).toContain('This invitation no longer works');
    expect(out).toContain('href="/login"');
  });
});
