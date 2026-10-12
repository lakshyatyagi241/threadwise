import { describe, expect, it } from 'vitest';
import {
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
