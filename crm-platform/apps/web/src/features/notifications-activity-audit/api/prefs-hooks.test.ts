import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type {
  NotificationPreferenceItem,
  UpdateNotificationPreferencesRequest,
} from '@crm/contracts';
import {
  applyChange,
  changeRequest,
  resetAll,
  resetRequest,
  customTypes,
  stateFromResponse,
  type PrefsState,
} from '../prefs/model';
import { NOTIFICATION_KEYS } from './keys';
import { PreferenceSaver, applyOptimistic } from './prefs-hooks';

const item = (type: string, over: Partial<NotificationPreferenceItem> = {}) =>
  ({
    type,
    group: 'conversations',
    bell: true,
    toast: true,
    sound: true,
    defaults: { bell: true, toast: true, sound: true },
    overrides: { bell: null, toast: null, sound: null },
    workspaceInapp: true,
    ...over,
  }) as NotificationPreferenceItem;

const start = (): PrefsState =>
  stateFromResponse({ items: [item('new_message'), item('mention')] });

function setup(send: (r: UpdateNotificationPreferencesRequest) => Promise<unknown>) {
  const qc = new QueryClient();
  qc.setQueryData(NOTIFICATION_KEYS.preferences, start());
  const calls = { fail: 0, busy: [] as boolean[], clear: 0 };
  const saver = new PreferenceSaver(qc, send, {
    fail: () => {
      calls.fail += 1;
    },
    busy: (b) => calls.busy.push(b),
    clear: () => {
      calls.clear += 1;
    },
  });
  const cache = () => qc.getQueryData<PrefsState>(NOTIFICATION_KEYS.preferences)!;
  const toggle = (type: string, channel: 'bell' | 'toast' | 'sound', value: boolean) =>
    saver.run((state) => {
      const next = applyChange(state, type, channel, value);
      return { next, request: changeRequest(next, type, channel) };
    });
  return { qc, saver, calls, cache, toggle };
}

describe('applyOptimistic', () => {
  it('shows the change at once and can undo it', () => {
    const qc = new QueryClient();
    const before = start();
    qc.setQueryData(NOTIFICATION_KEYS.preferences, before);
    const next = applyChange(before, 'new_message', 'toast', false);
    const undo = applyOptimistic(qc, next);
    expect(qc.getQueryData(NOTIFICATION_KEYS.preferences)).toEqual(next);
    undo();
    expect(qc.getQueryData(NOTIFICATION_KEYS.preferences)).toEqual(before);
  });

  it('does not overwrite a later change when an older one is undone', () => {
    const qc = new QueryClient();
    const before = start();
    qc.setQueryData(NOTIFICATION_KEYS.preferences, before);
    const first = applyChange(before, 'new_message', 'toast', false);
    const undoFirst = applyOptimistic(qc, first);
    const second = applyChange(first, 'mention', 'sound', false);
    applyOptimistic(qc, second);
    undoFirst();
    expect(qc.getQueryData(NOTIFICATION_KEYS.preferences)).toEqual(second);
  });
});

describe('PreferenceSaver', () => {
  it('updates the cache before the server answers, then sends the one changed channel', async () => {
    let release!: () => void;
    const send = vi.fn(() => new Promise<void>((r) => (release = r)));
    const h = setup(send);
    expect(h.toggle('new_message', 'toast', false)).toBe(true);
    expect(h.cache().entries.find((e) => e.type === 'new_message')!.flags.toast).toBe(false);
    await Promise.resolve();
    expect(send).toHaveBeenCalledWith({ items: [{ type: 'new_message', toast: false }] });
    expect(h.calls.busy).toEqual([true]);
    release();
    await h.saver.idle();
    expect(h.calls.busy).toEqual([true, false]);
    expect(h.calls.fail).toBe(0);
  });

  it('rolls back and reports a failed save', async () => {
    const send = vi.fn().mockRejectedValue(new Error('boom'));
    const h = setup(send);
    const before = h.cache();
    h.toggle('new_message', 'toast', false);
    expect(h.cache()).not.toEqual(before);
    await h.saver.idle();
    expect(h.cache()).toEqual(before);
    expect(h.calls.fail).toBe(1);
    expect(h.calls.busy.at(-1)).toBe(false);
  });

  it('clears an old failure when the next change starts', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const h = setup(send);
    h.toggle('new_message', 'toast', false);
    await h.saver.idle();
    const clearsBefore = h.calls.clear;
    h.toggle('mention', 'sound', false);
    expect(h.calls.clear).toBe(clearsBefore + 1);
    await h.saver.idle();
  });

  it('sends saves one at a time, in the order they were made', async () => {
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const send = vi.fn(async (r: UpdateNotificationPreferencesRequest) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(r.items[0]!.type);
      await Promise.resolve();
      inFlight -= 1;
    });
    const h = setup(send);
    h.toggle('new_message', 'toast', false);
    h.toggle('mention', 'sound', false);
    await h.saver.idle();
    expect(order).toEqual(['new_message', 'mention']);
    expect(maxInFlight).toBe(1);
  });

  it('refetches once, after the last queued save has settled', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const h = setup(send);
    const spy = vi.spyOn(h.qc, 'invalidateQueries');
    h.toggle('new_message', 'toast', false);
    h.toggle('mention', 'sound', false);
    await h.saver.idle();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: NOTIFICATION_KEYS.preferences });
  });

  it('sends nothing for a change that changes nothing, or before the list is loaded', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const h = setup(send);
    expect(h.toggle('new_message', 'toast', true)).toBe(false);
    const empty = new PreferenceSaver(new QueryClient(), send, {
      fail: () => undefined,
      busy: () => undefined,
      clear: () => undefined,
    });
    expect(empty.run((s) => ({ next: applyChange(s, 'x', 'bell', false), request: null }))).toBe(
      false,
    );
    await h.saver.idle();
    expect(send).not.toHaveBeenCalled();
  });

  it('resets everything the person changed in one request', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const h = setup(send);
    h.toggle('new_message', 'toast', false);
    h.toggle('mention', 'sound', false);
    await h.saver.idle();
    send.mockClear();
    h.saver.run((state) => ({ next: resetAll(state), request: resetRequest(customTypes(state)) }));
    expect(
      h.cache().entries.every((e) => e.overrides.toast === null && e.overrides.sound === null),
    ).toBe(true);
    await h.saver.idle();
    expect(send).toHaveBeenCalledWith({
      items: [
        { type: 'new_message', bell: null, toast: null, sound: null },
        { type: 'mention', bell: null, toast: null, sound: null },
      ],
    });
  });
});
