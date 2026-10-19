import { bellOff, popupOff, prefItem, prefsOf, workspaceOff } from '@/test/preferences-fixtures';
import {
  applyChange,
  changeRequest,
  customCount,
  customTypes,
  groupRows,
  resetAll,
  resetEntry,
  resetRequest,
  rowView,
  stateFromResponse,
} from './preferences-model';

const state = (...items: Parameters<typeof prefsOf>) => stateFromResponse(prefsOf(...items));

describe('how a preference reads on screen', () => {
  it('shows what is in force and lets every available switch be used', () => {
    const [entry] = state(prefItem('new_message')).entries;
    const row = rowView(entry!);
    expect(row.custom).toBe(false);
    expect(row.cells.bell).toEqual({ on: true, disabled: false, reason: null });
    expect(row.cells.toast).toEqual({ on: true, disabled: false, reason: null });
    expect(row.cells.push.disabled).toBe(false);
  });

  it('says a kind of notification has no pop-up or no sound at all', () => {
    const row = rowView(state(prefItem('task_completed')).entries[0]!);
    expect(row.cells.toast).toEqual({ on: false, disabled: true, reason: 'not_available' });
    expect(row.cells.sound.reason).toBe('not_available');
  });

  it('turns the pop-up, sound and push off while the bell is off', () => {
    const row = rowView(state(bellOff).entries[0]!);
    expect(row.custom).toBe(true);
    expect(row.cells.bell.on).toBe(false);
    expect(row.cells.push).toEqual({ on: false, disabled: true, reason: 'bell_off' });
  });

  it('keeps the switches usable when the workspace has the event off, and says so', () => {
    const row = rowView(state(workspaceOff).entries[0]!);
    expect(row.blocked).toBe(true);
    expect(row.cells.bell).toEqual({ on: false, disabled: false, reason: null });
  });

  it("groups by section in the web's order and puts a type this build does not know last", () => {
    const unknown = { ...prefItem('new_chat'), type: 'brand_new_thing' } as never;
    const groups = groupRows(
      state(prefItem('mention'), prefItem('new_chat'), unknown, prefItem('task_due')).entries,
    );
    expect(groups.map((g) => g.group)).toEqual(['conversations', 'tasks']);
    expect(groups[0]!.rows.map((r) => r.type)).toEqual(['new_chat', 'mention', 'brand_new_thing']);
  });
});

describe('changing a preference', () => {
  it('stores a choice that differs from the default', () => {
    const next = applyChange(state(prefItem('new_message')), 'new_message', 'toast', false);
    expect(next.entries[0]!.flags.toast).toBe(false);
    expect(next.entries[0]!.overrides.toast).toBe(false);
    expect(changeRequest(next, 'new_message', 'toast')).toEqual({
      items: [{ type: 'new_message', toast: false }],
    });
  });

  it('goes back to following the default when a switch is put back', () => {
    const next = applyChange(state(popupOff), 'new_message', 'toast', true);
    expect(next.entries[0]!.overrides.toast).toBeNull();
    expect(changeRequest(next, 'new_message', 'toast')).toEqual({
      items: [{ type: 'new_message', toast: null }],
    });
  });

  it('ignores a change to a switch that is off limits or already has that value', () => {
    const before = state(bellOff, prefItem('task_completed'));
    expect(applyChange(before, 'task_due', 'push', true)).toBe(before);
    expect(applyChange(before, 'task_completed', 'toast', true)).toBe(before);
    expect(applyChange(before, 'task_due', 'bell', false)).toBe(before);
    expect(applyChange(before, 'nope', 'bell', false)).toBe(before);
  });

  it('resets one type, or everything, and sends only what changed', () => {
    const before = state(popupOff, bellOff, prefItem('new_chat'));
    expect(customCount(before)).toBe(2);
    expect(customTypes(before)).toEqual(['new_message', 'task_due']);
    const one = resetEntry(before, 'new_message');
    expect(one.entries[0]!.flags.toast).toBe(true);
    expect(customCount(one)).toBe(1);
    expect(resetEntry(before, 'new_chat')).toBe(before);
    expect(customCount(resetAll(before))).toBe(0);
    expect(resetAll(state(prefItem('new_chat')))).toEqual(state(prefItem('new_chat')));
    expect(resetRequest(['new_message'])).toEqual({
      items: [{ type: 'new_message', bell: null, toast: null, sound: null, push: null }],
    });
    expect(resetRequest([])).toBeNull();
  });
});
