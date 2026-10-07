import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { draftResponse, uuid } from '../testing';
import { AUTOSAVE_DELAY_MS, Autosaver, type SaveStatus } from './autosave';

function setup(start: { id: string; rowVersion: number } | null = null) {
  const statuses: SaveStatus[] = [];
  const create = vi.fn(async () => draftResponse({}, { id: uuid(100), rowVersion: 1 }));
  const update = vi.fn(async (_id: string, _patch: unknown, rowVersion: number) =>
    draftResponse({}, { id: uuid(100), rowVersion: rowVersion + 1 }),
  );
  const saved: number[] = [];
  const saver = new Autosaver(
    { create, update, onStatus: (s) => statuses.push(s), onSaved: (r) => saved.push(r.rowVersion) },
    start,
  );
  return { saver, create, update, statuses, saved };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Autosaver', () => {
  it('waits for a pause, then creates the draft on the first change', async () => {
    const { saver, create, update, statuses } = setup();
    saver.change({ name: 'A' });
    expect(statuses).toEqual(['pending']);
    expect(create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(create).toHaveBeenCalledWith({ name: 'A' });
    expect(update).not.toHaveBeenCalled();
    expect(saver.status).toBe('saved');
    expect(saver.id).toBe(uuid(100));
    expect(saver.rowVersion).toBe(1);
  });

  it('merges edits made inside the pause into one request, restarting the timer', async () => {
    const { saver, create } = setup();
    saver.change({ name: 'A' });
    await vi.advanceTimersByTimeAsync(500);
    saver.change({ name: 'AB', step: 2 });
    await vi.advanceTimersByTimeAsync(500);
    expect(create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ name: 'AB', step: 2 });
  });

  it('later changes update with the row version of the last answer', async () => {
    const { saver, update } = setup();
    saver.change({ name: 'A' });
    await saver.flush();
    saver.change({ name: 'B' });
    await saver.flush();
    saver.change({ name: 'C' });
    await saver.flush();
    expect(update).toHaveBeenNthCalledWith(1, uuid(100), { name: 'B' }, 1);
    expect(update).toHaveBeenNthCalledWith(2, uuid(100), { name: 'C' }, 2);
  });

  it('flush saves at once and resolves true; with nothing waiting it resolves true without a request', async () => {
    const { saver, create } = setup();
    expect(await saver.flush()).toBe(true);
    expect(create).not.toHaveBeenCalled();
    saver.change({ name: 'A' });
    expect(await saver.flush()).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(create).toHaveBeenCalledTimes(1); // the timer was cancelled
  });

  it('starts from a loaded draft and updates it', async () => {
    const { saver, create, update } = setup({ id: uuid(100), rowVersion: 7 });
    saver.change({ step: 2 });
    await saver.flush();
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(uuid(100), { step: 2 }, 7);
  });

  it('an edit made while a save is in flight goes in the next request, in order', async () => {
    const { saver, update } = setup({ id: uuid(100), rowVersion: 1 });
    let release!: () => void;
    update.mockImplementationOnce(
      () =>
        new Promise((res) => {
          release = () => res(draftResponse({}, { rowVersion: 2 }));
        }),
    );
    saver.change({ name: 'A' });
    const first = saver.flush();
    await Promise.resolve();
    saver.change({ name: 'AB' });
    release();
    await first;
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(uuid(100), { name: 'AB' }, 2);
    expect(saver.status).toBe('saved');
  });

  it('a failed save keeps the changes, says error, and the next change tries again with everything', async () => {
    const { saver, create, statuses } = setup();
    create.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'x'));
    saver.change({ name: 'A' });
    expect(await saver.flush()).toBe(false);
    expect(saver.status).toBe('error');
    expect(saver.unsaved).toBe(true);
    saver.change({ step: 2 });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(create).toHaveBeenLastCalledWith({ name: 'A', step: 2 });
    expect(saver.status).toBe('saved');
    expect(saver.unsaved).toBe(false);
    expect(statuses).toContain('error');
  });

  it('a 409 stops saving and is never retried', async () => {
    const { saver, update } = setup({ id: uuid(100), rowVersion: 1 });
    update.mockRejectedValueOnce(new ApiError(409, 'ROW_VERSION_CONFLICT', 'moved'));
    saver.change({ name: 'A' });
    expect(await saver.flush()).toBe(false);
    expect(saver.status).toBe('conflict');
    saver.change({ name: 'AB' });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
    expect(update).toHaveBeenCalledTimes(1);
    expect(await saver.flush()).toBe(false);
    expect(saver.unsaved).toBe(true);
  });

  it('reset takes a freshly loaded draft and drops what was waiting', async () => {
    const { saver, update } = setup({ id: uuid(100), rowVersion: 1 });
    update.mockRejectedValueOnce(new ApiError(409, 'ROW_VERSION_CONFLICT', 'moved'));
    saver.change({ name: 'A' });
    await saver.flush();
    saver.reset({ id: uuid(100), rowVersion: 9 });
    expect(saver.status).toBe('saved');
    saver.change({ name: 'Z' });
    await saver.flush();
    expect(update).toHaveBeenLastCalledWith(uuid(100), { name: 'Z' }, 9);
  });

  it('sends nothing for a patch of half-typed values only', async () => {
    const { saver, update } = setup({ id: uuid(100), rowVersion: 1 });
    saver.change({ schedule: { mode: 'scheduled', date: '', time: '09:00', timezone: 'UTC' } });
    expect(await saver.flush()).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it('ignores an empty change and can be disposed', async () => {
    const { saver, create } = setup();
    saver.change({});
    expect(saver.status).toBe('idle');
    saver.change({ name: 'A' });
    saver.dispose();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(create).not.toHaveBeenCalled();
  });
});
