import { describe, expect, it } from 'vitest';
import type { NotificationPreferenceItem } from '@crm/contracts';
import {
  applyChange,
  changeRequest,
  customCount,
  customTypes,
  entryFromItem,
  groupRows,
  isCustom,
  mayAlert,
  mayPush,
  resetAll,
  resetEntry,
  resetRequest,
  rowView,
  stateFromResponse,
  type PrefEntry,
  type PrefsState,
} from './model';

const item = (
  over: Partial<NotificationPreferenceItem> & Pick<NotificationPreferenceItem, 'type' | 'group'>,
): NotificationPreferenceItem => ({
  bell: true,
  toast: true,
  sound: false,
  push: false,
  defaults: { bell: true, toast: true, sound: false, push: false },
  overrides: { bell: null, toast: null, sound: null, push: null },
  workspaceInapp: true,
  ...over,
});

const MESSAGE = item({
  type: 'new_message',
  group: 'conversations',
  sound: true,
  push: true,
  defaults: { bell: true, toast: true, sound: true, push: true },
});
const DEVICE = item({ type: 'device_disconnected', group: 'devices' });
const TASK_DONE = item({
  type: 'task_completed',
  group: 'tasks',
  toast: false,
  defaults: { bell: true, toast: false, sound: false, push: false },
});
const state = (...items: NotificationPreferenceItem[]): PrefsState =>
  stateFromResponse({ items: items.length ? items : [MESSAGE, DEVICE, TASK_DONE] });
const find = (s: PrefsState, type: string) => s.entries.find((e) => e.type === type)!;

describe('reading the server list', () => {
  it('keeps what is in force, the default and the person own choices', () => {
    const e = entryFromItem(
      item({
        type: 'new_message',
        group: 'conversations',
        toast: false,
        overrides: { bell: null, toast: false, sound: null, push: null },
        defaults: { bell: true, toast: true, sound: true, push: true },
      }),
    );
    expect(e.flags).toEqual({ bell: true, toast: false, sound: false, push: false });
    expect(e.defaults).toEqual({ bell: true, toast: true, sound: true, push: true });
    expect(e.overrides).toEqual({ bell: null, toast: false, sound: null, push: null });
    expect(e.workspaceEnabled).toBe(true);
    expect(isCustom(e)).toBe(true);
  });

  it('takes the bell default from the workspace toggle', () => {
    const e = entryFromItem(
      item({ type: 'new_message', group: 'conversations', bell: false, workspaceInapp: false }),
    );
    expect(e.defaults.bell).toBe(false);
    expect(e.workspaceEnabled).toBe(false);
  });
});

describe('how a row reads (disabled states)', () => {
  it('shows the switches as they are when nothing is in the way', () => {
    const v = rowView(find(state(), 'new_message'));
    expect(v.blocked).toBe(false);
    expect(v.custom).toBe(false);
    expect(v.cells.bell).toEqual({ on: true, disabled: false, reason: null });
    expect(v.cells.toast).toEqual({ on: true, disabled: false, reason: null });
    expect(v.cells.sound).toEqual({ on: true, disabled: false, reason: null });
    expect(v.cells.push).toEqual({ on: true, disabled: false, reason: null });
  });

  it('keeps the bell switch usable when the workspace has the event off (the server lets the personal choice win)', () => {
    const v = rowView(
      entryFromItem(
        item({ type: 'new_message', group: 'conversations', workspaceInapp: false, bell: false }),
      ),
    );
    // The note on the row is driven by `blocked`; nothing is disabled because of the workspace.
    expect(v.blocked).toBe(true);
    expect(v.cells.bell).toEqual({ on: false, disabled: false, reason: null });
    // The extras need the bell, exactly as when the person turned it off themselves.
    for (const c of [v.cells.toast, v.cells.sound, v.cells.push]) {
      expect(c).toEqual({ on: false, disabled: true, reason: 'bell_off' });
    }
  });

  it('lets a person turn an event on for themselves although the workspace has it off, and then offers the rest', () => {
    const workspaceOff = state(
      item({ type: 'new_message', group: 'conversations', workspaceInapp: false, bell: false }),
    );
    const on = applyChange(workspaceOff, 'new_message', 'bell', true);
    const e = find(on, 'new_message');
    expect(e.flags.bell).toBe(true);
    // Different from the workspace default, so it is a choice of their own and is sent.
    expect(e.overrides.bell).toBe(true);
    expect(changeRequest(on, 'new_message', 'bell')).toEqual({
      items: [{ type: 'new_message', bell: true }],
    });
    const v = rowView(e);
    expect(v.blocked).toBe(true);
    expect(v.cells.toast.disabled).toBe(false);
    expect(v.cells.push.disabled).toBe(false);
    // Resetting returns to following the workspace.
    expect(find(resetEntry(on, 'new_message'), 'new_message').flags.bell).toBe(false);
  });

  it('disables the pop-up and sound while the bell is off, but keeps the bell switch live', () => {
    const v = rowView(
      entryFromItem(
        item({
          type: 'new_message',
          group: 'conversations',
          bell: false,
          overrides: { bell: false, toast: null, sound: null, push: null },
        }),
      ),
    );
    expect(v.cells.bell).toEqual({ on: false, disabled: false, reason: null });
    expect(v.cells.toast).toEqual({ on: false, disabled: true, reason: 'bell_off' });
    expect(v.cells.sound).toEqual({ on: false, disabled: true, reason: 'bell_off' });
    expect(v.cells.push).toEqual({ on: false, disabled: true, reason: 'bell_off' });
  });

  it('marks a switch the kind of event does not offer (no ping for a device)', () => {
    const v = rowView(find(state(), 'device_disconnected'));
    expect(v.cells.sound).toEqual({ on: false, disabled: true, reason: 'not_available' });
    expect(v.cells.toast.disabled).toBe(false);
    // Every kind of event can be pushed to a device.
    expect(v.cells.push.reason).not.toBe('not_available');
    const done = rowView(find(state(), 'task_completed'));
    expect(done.cells.toast.reason).toBe('not_available');
  });
});

describe('grouping', () => {
  it('lists groups in the contracts order and types in catalogue order, and skips empty groups', () => {
    const groups = groupRows(
      state(
        item({ type: 'teamchat_mention', group: 'team_chat' }),
        item({ type: 'mention', group: 'conversations' }),
        item({ type: 'new_chat', group: 'conversations' }),
        item({ type: 'device_connected', group: 'devices' }),
      ).entries,
    );
    expect(groups.map((g) => g.group)).toEqual(['conversations', 'devices', 'team_chat']);
    expect(groups[0]!.rows.map((r) => r.type)).toEqual(['new_chat', 'mention']);
  });

  it('puts a type this build does not know last in its group', () => {
    const groups = groupRows(
      state(
        item({ type: 'zzz_future' as never, group: 'devices' }),
        item({ type: 'device_connected', group: 'devices' }),
      ).entries,
    );
    expect(groups[0]!.rows.map((r) => r.type)).toEqual(['device_connected', 'zzz_future']);
  });
});

describe('optimistic changes', () => {
  it('records a choice that differs from the default and flips the value in force', () => {
    const next = applyChange(state(), 'new_message', 'toast', false);
    const e = find(next, 'new_message');
    expect(e.flags.toast).toBe(false);
    expect(e.overrides).toEqual({ bell: null, toast: false, sound: null, push: null });
    expect(isCustom(e)).toBe(true);
    expect(customCount(next)).toBe(1);
  });

  it('goes back to following the default when a switch is put back to the default value', () => {
    const off = applyChange(state(), 'new_message', 'toast', false);
    const back = applyChange(off, 'new_message', 'toast', true);
    expect(find(back, 'new_message').overrides.toast).toBeNull();
    expect(isCustom(find(back, 'new_message'))).toBe(false);
  });

  it('does not mutate the state it was given', () => {
    const s = state();
    const before = JSON.stringify(s);
    applyChange(s, 'new_message', 'bell', false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('returns the same state for a no-op, an unknown type or a disabled switch', () => {
    const s = state();
    expect(applyChange(s, 'new_message', 'bell', true)).toBe(s);
    expect(applyChange(s, 'nope', 'bell', false)).toBe(s);
    expect(applyChange(s, 'device_disconnected', 'sound', true)).toBe(s);
    const bellOff = applyChange(s, 'new_message', 'bell', false);
    expect(applyChange(bellOff, 'new_message', 'toast', false)).toBe(bellOff);
  });

  it('keeps the pop-up and sound choices when the bell is turned off and back on', () => {
    const quiet = applyChange(state(), 'new_message', 'sound', false);
    const bellOff = applyChange(quiet, 'new_message', 'bell', false);
    const bellOn = applyChange(bellOff, 'new_message', 'bell', true);
    expect(find(bellOn, 'new_message').overrides).toEqual({
      bell: null,
      toast: null,
      sound: false,
      push: null,
    });
    expect(find(bellOn, 'new_message').flags.sound).toBe(false);
  });

  it('records a push choice like any other channel, and goes back to the default when put back', () => {
    const off = applyChange(state(), 'new_message', 'push', false);
    expect(find(off, 'new_message').overrides.push).toBe(false);
    expect(changeRequest(off, 'new_message', 'push')).toEqual({
      items: [{ type: 'new_message', push: false }],
    });
    const on = applyChange(state(), 'device_disconnected', 'push', true);
    expect(find(on, 'device_disconnected').overrides.push).toBe(true);
    const back = applyChange(off, 'new_message', 'push', true);
    expect(find(back, 'new_message').overrides.push).toBeNull();
  });
});

describe('requests', () => {
  it('sends only the changed channel, as the person choice (null = default)', () => {
    const off = applyChange(state(), 'new_message', 'toast', false);
    expect(changeRequest(off, 'new_message', 'toast')).toEqual({
      items: [{ type: 'new_message', toast: false }],
    });
    const back = applyChange(off, 'new_message', 'toast', true);
    expect(changeRequest(back, 'new_message', 'toast')).toEqual({
      items: [{ type: 'new_message', toast: null }],
    });
    expect(changeRequest(off, 'nope', 'toast')).toBeNull();
  });

  it('resets types by sending null for all four channels, and sends nothing for no types', () => {
    expect(resetRequest(['new_message', 'task_completed'])).toEqual({
      items: [
        { type: 'new_message', bell: null, toast: null, sound: null, push: null },
        { type: 'task_completed', bell: null, toast: null, sound: null, push: null },
      ],
    });
    expect(resetRequest([])).toBeNull();
  });
});

describe('reset', () => {
  const changed = (): PrefsState =>
    applyChange(
      applyChange(state(), 'new_message', 'toast', false),
      'device_disconnected',
      'bell',
      false,
    );

  it('puts one type back to its defaults and leaves the others', () => {
    const next = resetEntry(changed(), 'new_message');
    expect(isCustom(find(next, 'new_message'))).toBe(false);
    expect(find(next, 'new_message').flags).toEqual(find(next, 'new_message').defaults);
    expect(isCustom(find(next, 'device_disconnected'))).toBe(true);
  });

  it('puts everything back and lists what was changed', () => {
    expect(customTypes(changed()).sort()).toEqual(['device_disconnected', 'new_message']);
    const next = resetAll(changed());
    expect(customCount(next)).toBe(0);
    expect(next.entries.every((e: PrefEntry) => !isCustom(e))).toBe(true);
  });

  it('returns the same state when nothing was changed', () => {
    const s = state();
    expect(resetEntry(s, 'new_message')).toBe(s);
    expect(resetAll(s)).toBe(s);
  });
});

describe('mayAlert (what the live alerts ask)', () => {
  it('uses the type default with no preferences loaded', () => {
    expect(mayAlert(undefined, 'new_message', 'toast')).toBe(true);
    expect(mayAlert(undefined, 'new_message', 'sound')).toBe(true);
    expect(mayAlert(undefined, 'device_disconnected', 'toast')).toBe(true);
    expect(mayAlert(undefined, 'device_disconnected', 'sound')).toBe(false);
    expect(mayAlert(undefined, 'task_completed', 'toast')).toBe(false);
    expect(mayAlert(undefined, 'never_heard_of_it', 'toast')).toBe(false);
  });

  it('honours the person pop-up and sound choices, the bell and the workspace', () => {
    const quiet = applyChange(state(), 'new_message', 'sound', false);
    expect(mayAlert(quiet.entries, 'new_message', 'sound')).toBe(false);
    expect(mayAlert(quiet.entries, 'new_message', 'toast')).toBe(true);
    const noBell = applyChange(state(), 'new_message', 'bell', false);
    expect(mayAlert(noBell.entries, 'new_message', 'toast')).toBe(false);
    const blocked = state(
      item({ type: 'new_message', group: 'conversations', workspaceInapp: false, bell: false }),
    );
    // Off by the workspace and never chosen: no row, so nothing to pop up.
    expect(mayAlert(blocked.entries, 'new_message', 'toast')).toBe(false);
    // The person turned it on for themselves: their alerts work although the workspace has it off.
    const ownChoice = applyChange(blocked, 'new_message', 'bell', true);
    expect(mayAlert(ownChoice.entries, 'new_message', 'toast')).toBe(true);
  });

  it('keeps the type default for a type missing from the list', () => {
    expect(mayAlert(state(DEVICE).entries, 'new_message', 'toast')).toBe(true);
  });
});

describe('mayPush (does a browser push already cover this event?)', () => {
  it('uses the catalogue default with no preferences loaded: on for a chat event, off for a quiet one', () => {
    expect(mayPush(undefined, 'new_message')).toBe(true);
    expect(mayPush(undefined, 'wallet_credited')).toBe(false);
    expect(mayPush(undefined, 'never_heard_of_it')).toBe(false);
  });

  it('follows the personal push choice, and needs the bell', () => {
    const off = applyChange(state(), 'new_message', 'push', false);
    expect(mayPush(off.entries, 'new_message')).toBe(false);
    const noBell = applyChange(state(), 'new_message', 'bell', false);
    expect(mayPush(noBell.entries, 'new_message')).toBe(false);
    expect(mayPush(state().entries, 'new_message')).toBe(true);
  });
});
