import { describe, expect, it } from 'vitest';
import {
  effectiveScope,
  mailboxAccess,
  orderedProviders,
  providerState,
  scopeRights,
  sendLimitDraft,
  sharingDirty,
  canSync,
  connectState,
  inboxHref,
  nameDraft,
  needsReconnect,
  statusView,
  usageOf,
} from './hub-model';

describe('mailbox status chip', () => {
  it('maps each status to a tone and its own message key', () => {
    expect(statusView('connected')).toEqual({ tone: 'success', key: 'connected' });
    expect(statusView('needs_reauth')).toEqual({ tone: 'warning', key: 'needs_reauth' });
    expect(statusView('error')).toEqual({ tone: 'danger', key: 'error' });
    expect(statusView('disconnected')).toEqual({ tone: 'neutral', key: 'disconnected' });
  });

  it('offers Sync now only to a mailbox that can sync, and Reconnect to one that cannot', () => {
    expect(canSync({ status: 'connected' })).toBe(true);
    expect(canSync({ status: 'error' })).toBe(true);
    expect(canSync({ status: 'needs_reauth' })).toBe(false);
    expect(canSync({ status: 'disconnected' })).toBe(false);
    expect(needsReconnect({ status: 'needs_reauth' })).toBe(true);
    expect(needsReconnect({ status: 'disconnected' })).toBe(true);
    expect(needsReconnect({ status: 'connected' })).toBe(false);
    expect(needsReconnect({ status: 'error' })).toBe(false);
  });
});

describe('open in inbox', () => {
  it('filters the inbox by the mailbox channel, and has no link before the channel exists', () => {
    expect(inboxHref({ channelId: '0b6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f50' })).toBe(
      '/inbox?channel=0b6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f50',
    );
    expect(inboxHref({ channelId: null })).toBeNull();
  });
});

describe('mailbox usage meter', () => {
  it('counts against the plan limit', () => {
    expect(usageOf({ used: 1, limit: 3 })).toEqual({
      used: 1,
      limit: 3,
      unlimited: false,
      reached: false,
    });
    expect(usageOf({ used: 3, limit: 3 }).reached).toBe(true);
    expect(usageOf({ used: 4, limit: 3 }).reached).toBe(true);
  });

  it('treats 0 as unlimited and never reached', () => {
    expect(usageOf({ used: 40, limit: 0 })).toMatchObject({ unlimited: true, reached: false });
  });

  it('is empty before the list loads', () => {
    expect(usageOf(undefined)).toMatchObject({ used: 0, reached: false });
  });
});

describe('what the Connect Gmail card does', () => {
  const list = (o: Partial<{ used: number; limit: number; providerReady: boolean }> = {}) => ({
    used: 1,
    limit: 3,
    providerReady: true,
    ...o,
  });

  it('is ready for a manager with room and a configured platform', () => {
    expect(connectState(list(), true)).toBe('ready');
    expect(connectState(undefined, true)).toBe('ready');
  });

  it('says who to ask when the platform has no Google credentials', () => {
    expect(connectState(list({ providerReady: false }), true)).toBe('not_ready');
  });

  it('explains the plan limit', () => {
    expect(connectState(list({ used: 3 }), true)).toBe('limit');
    expect(connectState(list({ used: 9, limit: 0 }), true)).toBe('ready');
  });

  it('without the manage permission, never offers the button', () => {
    expect(connectState(list(), false)).toBe('no_permission');
    expect(connectState(list({ providerReady: false }), false)).toBe('no_permission');
  });
});

describe('display name draft', () => {
  it('trims, needs 1 to 80 characters and notes whether it changed', () => {
    expect(nameDraft('Support', '  Help desk ')).toEqual({
      ok: true,
      value: 'Help desk',
      changed: true,
    });
    expect(nameDraft('Support', 'Support ')).toEqual({
      ok: true,
      value: 'Support',
      changed: false,
    });
    expect(nameDraft('Support', '   ').ok).toBe(false);
    expect(nameDraft('Support', 'x'.repeat(81)).ok).toBe(false);
    expect(nameDraft('Support', 'x'.repeat(80)).ok).toBe(true);
  });
});

describe('provider cards', () => {
  it('orders google, microsoft, imap and drops what the API does not list', () => {
    const info = (provider: 'google' | 'microsoft' | 'imap') => ({
      provider,
      label: provider,
      kind: provider === 'imap' ? ('password' as const) : ('oauth' as const),
      ready: true,
      notReadyReason: null,
    });
    expect(orderedProviders([info('imap'), info('google')], true).map((p) => p.provider)).toEqual([
      'google',
      'imap',
    ]);
    expect(orderedProviders(undefined, false).map((p) => [p.provider, p.ready])).toEqual([
      ['google', false],
      ['microsoft', false],
      ['imap', true],
    ]);
  });

  it('checks the right to connect, then the platform setup, then the plan limit', () => {
    const list = { used: 3, limit: 3 };
    expect(providerState({ ready: false }, list, false)).toBe('no_permission');
    expect(providerState({ ready: false }, list, true)).toBe('not_ready');
    expect(providerState({ ready: true }, list, true)).toBe('limit');
    expect(providerState({ ready: true }, { used: 1, limit: 3 }, true)).toBe('ready');
  });
});

describe('who may connect which scope', () => {
  const on = { personalMailboxesEnabled: true, whoMayConnectPersonal: 'agents' as const };
  it('never offers personal while the workspace policy is off', () => {
    expect(
      scopeRights(
        { personalMailboxesEnabled: false, whoMayConnectPersonal: 'agents' },
        { manage: true, managePersonal: true, isAdmin: true },
      ).personal,
    ).toBe(false);
    expect(
      scopeRights(undefined, { manage: true, managePersonal: true, isAdmin: true }).personal,
    ).toBe(false);
  });

  it('lets any holder of the permission connect when agents may, only admins otherwise', () => {
    const agent = { manage: false, managePersonal: true, isAdmin: false };
    expect(scopeRights(on, agent)).toEqual({ shared: false, personal: true });
    expect(scopeRights({ ...on, whoMayConnectPersonal: 'admins' }, agent).personal).toBe(false);
    expect(
      scopeRights({ ...on, whoMayConnectPersonal: 'admins' }, { ...agent, isAdmin: true }).personal,
    ).toBe(true);
    expect(scopeRights(on, { manage: true, managePersonal: false, isAdmin: false }).personal).toBe(
      false,
    );
  });

  it('falls back to the one scope the viewer has', () => {
    expect(effectiveScope('personal', { shared: true, personal: false })).toBe('shared');
    expect(effectiveScope('shared', { shared: false, personal: true })).toBe('personal');
    expect(effectiveScope('personal', { shared: true, personal: true })).toBe('personal');
    expect(effectiveScope('shared', { shared: false, personal: false })).toBeNull();
  });
});

describe('what a viewer may do with a mailbox card', () => {
  const me = { id: 'me', manage: true, managePersonal: true };
  const shared = { scope: 'shared' as const, ownerUserId: null, channelId: 'c1' };
  const mine = { scope: 'personal' as const, ownerUserId: 'me', channelId: 'c2' };
  const theirs = { scope: 'personal' as const, ownerUserId: 'they', channelId: 'c3' };

  it('lets managers act on shared mailboxes and nobody else', () => {
    expect(mailboxAccess(shared, me, false)).toEqual({
      summaryOnly: false,
      canAct: true,
      canOpen: true,
    });
    expect(mailboxAccess(shared, { ...me, manage: false }, false).canAct).toBe(false);
  });

  it('lets the owner act on their personal mailbox, even without the shared manage right', () => {
    expect(mailboxAccess(mine, { ...me, manage: false }, false)).toEqual({
      summaryOnly: false,
      canAct: true,
      canOpen: true,
    });
    expect(mailboxAccess(mine, { ...me, manage: false, managePersonal: false }, false).canAct).toBe(
      false,
    );
  });

  it("shows someone else's personal mailbox as a summary, with no actions, even to an admin", () => {
    expect(mailboxAccess(theirs, me, false)).toEqual({
      summaryOnly: true,
      canAct: false,
      canOpen: false,
    });
  });

  it('opens it for admins only when the policy lets them read it, and still offers no actions', () => {
    expect(mailboxAccess(theirs, me, true)).toEqual({
      summaryOnly: false,
      canAct: false,
      canOpen: true,
    });
    expect(mailboxAccess({ ...theirs, channelId: null }, me, true).canOpen).toBe(false);
  });
});

describe('send limit field', () => {
  it('treats empty as the platform default', () => {
    expect(sendLimitDraft('', 50)).toEqual({ ok: true, value: null, changed: true });
    expect(sendLimitDraft(' ', null)).toEqual({ ok: true, value: null, changed: false });
  });
  it('accepts whole numbers from 1 to 10000 only', () => {
    expect(sendLimitDraft('40', null)).toEqual({ ok: true, value: 40, changed: true });
    expect(sendLimitDraft('40', 40).changed).toBe(false);
    for (const bad of ['0', '10001', '-3', '1.5', 'abc'])
      expect(sendLimitDraft(bad, null).ok).toBe(false);
  });
});

describe('sharing form', () => {
  const base = {
    personalMailboxesEnabled: false,
    whoMayConnectPersonal: 'admins' as const,
    adminsCanReadPersonal: false,
  };
  it('is dirty only when something differs from the saved policy', () => {
    expect(sharingDirty(base, { ...base })).toBe(false);
    expect(sharingDirty(base, { ...base, personalMailboxesEnabled: true })).toBe(true);
    expect(sharingDirty(base, { ...base, whoMayConnectPersonal: 'agents' })).toBe(true);
    expect(sharingDirty(base, { ...base, adminsCanReadPersonal: true })).toBe(true);
  });
});
