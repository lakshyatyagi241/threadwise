// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@crm/contracts';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  overview: null as unknown,
  dialog: [] as Array<Record<string, unknown>>,
}));

vi.mock('../api/hooks', () => ({
  useMembersSummary: () => ({ data: { me: { id: 'm-me' } } }),
}));
vi.mock('../api/leave', () => ({
  useLeaveOverview: (id: string | null) => ({ data: id ? state.overview : undefined }),
}));
vi.mock('./member-leave-dialog', () => ({
  MemberLeaveDialog: (props: Record<string, unknown>) => {
    state.dialog.push(props);
    return null;
  },
}));

import { MyLeaveDialog, MyLeaveRow } from './my-leave-row';

const messages = JSON.parse(
  readFileSync(join(__dirname, '../../../../messages/en/workspaces-teams-tenancy.json'), 'utf8'),
) as Record<string, unknown>;

const sessionWith = (permissions: Record<string, string>) =>
  ({ permissions }) as unknown as SessionResponse;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  state.overview = { current: null };
  state.dialog = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (permissions: Record<string, string>, onOpen = () => undefined) =>
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SessionProvider session={sessionWith(permissions)}>
          <MyLeaveRow onOpen={onOpen} />
          <MyLeaveDialog open onClose={() => undefined} />
        </SessionProvider>
      </NextIntlClientProvider>,
    );
  });

const row = () => host.querySelector('[data-testid="user-menu-leave"]') as HTMLButtonElement | null;

describe('the account menu Time off row', () => {
  it('shows for a role that holds team.leave.manage but not team.read (a Viewer)', () => {
    render({ 'team.leave.manage': 'own', 'team.leave.read': 'all' });
    expect(row()?.textContent).toContain('Time off');
  });

  it('is absent without team.leave.manage, even for someone who can read the team', () => {
    render({ 'team.read': 'all', 'team.leave.read': 'all' });
    expect(row()).toBeNull();
    expect(state.dialog.at(-1)?.open).toBe(false);
  });

  it('says "On leave until <date>" while away', () => {
    state.overview = { current: { endsOn: '2026-10-20' } };
    render({ 'team.leave.manage': 'own' });
    expect(row()?.textContent).toContain('On leave until Oct 20, 2026');
  });

  it('says "On leave" for a leave with no end date', () => {
    state.overview = { current: { endsOn: null } };
    render({ 'team.leave.manage': 'own' });
    expect(row()?.textContent).toContain('On leave');
    expect(row()?.textContent).not.toContain('until');
  });

  it('opens the dialog for yourself: your own member id, self mode', () => {
    const onOpen = vi.fn();
    render({ 'team.leave.manage': 'own' }, onOpen);
    act(() => row()!.click());
    expect(onOpen).toHaveBeenCalledOnce();
    expect(state.dialog.at(-1)).toMatchObject({ memberId: 'm-me', self: true, open: true });
  });
});
