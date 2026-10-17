// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { StatusOptionResponse } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('../api/contacts', async (orig) => ({
  ...(await orig<typeof import('../api/contacts')>()),
  updateContact: api.update,
}));

const opt = (over: Partial<StatusOptionResponse>): StatusOptionResponse => ({
  id: 'id',
  moduleKey: 'contacts',
  optionGroup: 'status',
  value: 'x',
  label: 'X',
  color: null,
  position: 0,
  isDefault: false,
  isActive: true,
  isWon: false,
  isLost: false,
  stageOptionId: null,
  rowVersion: 1,
  ...over,
});
const stage = (value: string, over: Partial<StatusOptionResponse> = {}) =>
  opt({ id: `stage-${value}`, optionGroup: 'lifecycle_stage', value, label: value, ...over });
const status = (value: string, over: Partial<StatusOptionResponse> = {}) =>
  opt({ id: `status-${value}`, value, label: value.replace(/_/g, ' '), ...over });

/** new / qualified / lost; qualified has a default sub-state, lost one, "do not contact" is valid anywhere. */
const OPTIONS: StatusOptionResponse[] = [
  stage('new', { isDefault: true }),
  stage('qualified', { position: 1 }),
  stage('lost', { position: 2, isLost: true }),
  status('waiting_for_quote', { stageOptionId: 'stage-qualified', isDefault: true }),
  status('quote_sent', { stageOptionId: 'stage-qualified', position: 1 }),
  status('not_interested', { stageOptionId: 'stage-lost', isDefault: true, position: 2 }),
  status('do_not_contact', { position: 3 }),
];
vi.mock('../api/attributes', async (orig) => ({
  ...(await orig<typeof import('../api/attributes')>()),
  useStatusOptions: () => ({ data: OPTIONS, isSuccess: true }),
}));

import { KEYS } from '../api/contacts';
import { UNDO_MS, useStageMove, type StageTarget } from './use-stage-move';

const ID = '294dca7c-5806-4548-9035-dcca9befc7b1';
const contact = (over: Record<string, unknown> = {}) => ({
  id: ID,
  name: 'Priya',
  lifecycleStage: 'new',
  status: 'do_not_contact',
  rowVersion: 3,
  ...over,
});
const target = (over: Partial<StageTarget> = {}): StageTarget => ({
  id: ID,
  name: 'Priya',
  rowVersion: 3,
  stage: 'new',
  status: 'do_not_contact',
  ...over,
});

let host: HTMLElement;
let root: Root;
let qc: QueryClient;
let hook: ReturnType<typeof useStageMove>;

function Probe() {
  hook = useStageMove();
  return <>{hook.dialog}</>;
}

function mount(ui: ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={qc}>
          <ToastProvider dismissLabel="Dismiss">{ui}</ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}

const cached = () =>
  qc.getQueryData<{ lifecycleStage: string; status: string | null }>(KEYS.contact(ID))!;
const toasts = () => document.body.textContent ?? '';

beforeEach(() => {
  // jsdom has no modal dialogs: the lost-reason dialog only needs these two to exist.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  vi.useFakeTimers();
  api.update.mockReset();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(KEYS.contact(ID), contact());
  mount(<Probe />);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('useStageMove', () => {
  it('changes the screen before the server answers (optimistic) and keeps the status the stage allows', async () => {
    let answer!: (v: unknown) => void;
    api.update.mockReturnValue(new Promise((r) => (answer = r)));
    let done!: Promise<boolean>;
    await act(async () => {
      done = hook.move(target(), { stage: 'qualified' });
    });
    // The API's rule: "do not contact" is valid anywhere, so it stays; the stage is already the new one.
    expect(cached().lifecycleStage).toBe('qualified');
    expect(cached().status).toBe('do_not_contact');
    expect(hook.busyId).toBe(ID);
    expect(api.update).toHaveBeenCalledWith(ID, { lifecycleStage: 'qualified', rowVersion: 3 });
    await act(async () => {
      answer({ ...contact({ lifecycleStage: 'qualified' }), rowVersion: 4 });
      await done;
    });
    expect(hook.busyId).toBeNull();
    expect(toasts()).toContain('Stage changed to qualified.');
  });

  it('applies the linking rules in the preview: a status that does not fit the new stage is reset to its default', async () => {
    api.update.mockReturnValue(new Promise(() => undefined));
    await act(async () => {
      void hook.move(target({ status: 'quote_sent', stage: 'qualified' }), { stage: 'lost' });
    });
    // The prompt for the reason comes first for a lost stage: nothing is saved yet.
    expect(api.update).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('lost');
    expect(hook.hintFor('quote_sent', 'new')).toBe('Status will be cleared');
    expect(hook.hintFor('quote_sent', 'lost')).toBe('Status becomes not interested');
    expect(hook.hintFor('do_not_contact', 'qualified')).toBeNull();
    expect(hook.defaultStatusOf('qualified')).toBe('waiting_for_quote');
    expect(hook.statusesOf('qualified').map((c) => c.value)).toEqual([
      'waiting_for_quote',
      'quote_sent',
      'do_not_contact',
    ]);
    expect(hook.statusesOf('lost').map((c) => c.value)).toEqual([
      'not_interested',
      'do_not_contact',
    ]);
  });

  it('sends the status the person picked under the stage, in the same save', async () => {
    api.update.mockResolvedValue({
      ...contact({ lifecycleStage: 'qualified', status: 'quote_sent' }),
      rowVersion: 4,
    });
    await act(async () => {
      await hook.move(target(), { stage: 'qualified', status: 'quote_sent' });
    });
    expect(api.update).toHaveBeenCalledWith(ID, {
      lifecycleStage: 'qualified',
      status: 'quote_sent',
      rowVersion: 3,
    });
    expect(toasts()).toContain('Stage changed to qualified.');
  });

  it('goes back and says why when the server refuses (rollback)', async () => {
    api.update.mockRejectedValue(new Error('boom'));
    await act(async () => {
      expect(await hook.move(target(), { stage: 'qualified' })).toBe(false);
    });
    expect(cached().lifecycleStage).toBe('new');
    expect(cached().status).toBe('do_not_contact');
    expect(toasts()).toContain('The stage could not be changed');
    expect(hook.busyId).toBeNull();
  });

  it('puts every cached list row back too', async () => {
    const list = { response: { data: [contact(), contact({ id: 'other' })] }, index: 0 };
    qc.setQueryData([...KEYS.contacts, 'page'], list);
    api.update.mockRejectedValue(new Error('boom'));
    await act(async () => {
      await hook.move(target(), { stage: 'qualified' });
    });
    const after = qc.getQueryData<typeof list>([...KEYS.contacts, 'page'])!;
    expect(after.response.data[0]!.lifecycleStage).toBe('new');
  });

  it('offers Undo for eight seconds, and Undo moves the contact back to the stage and status it came from', async () => {
    api.update
      .mockResolvedValueOnce({
        ...contact({ lifecycleStage: 'qualified', status: 'waiting_for_quote' }),
        rowVersion: 4,
      })
      .mockResolvedValueOnce({ ...contact(), rowVersion: 5 });
    await act(async () => {
      await hook.move(target({ status: 'do_not_contact' }), {
        stage: 'qualified',
        status: 'waiting_for_quote',
      });
    });
    const undo = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Undo',
    )!;
    expect(undo).toBeTruthy();
    expect(UNDO_MS).toBe(8000);
    await act(async () => {
      undo.click();
    });
    // The second save carries the new row version and the old stage and status.
    expect(api.update).toHaveBeenLastCalledWith(ID, {
      lifecycleStage: 'new',
      status: 'do_not_contact',
      rowVersion: 4,
    });
    expect(toasts()).toContain('Moved back to new.');
    // and a moved-back contact does not offer Undo again
    expect(
      [...document.body.querySelectorAll('button')].some((b) => b.textContent === 'Undo'),
    ).toBe(false);
  });

  it('keeps the Undo on screen for eight seconds, not five', async () => {
    api.update.mockResolvedValue({ ...contact({ lifecycleStage: 'qualified' }), rowVersion: 4 });
    await act(async () => {
      await hook.move(target(), { stage: 'qualified' });
    });
    act(() => void vi.advanceTimersByTime(6000));
    expect(toasts()).toContain('Undo');
    act(() => void vi.advanceTimersByTime(2500));
    expect(toasts()).not.toContain('Undo');
  });

  it('does nothing for a move to the stage the contact is already in', async () => {
    await act(async () => {
      expect(await hook.move(target(), { stage: 'new' })).toBe(true);
    });
    expect(api.update).not.toHaveBeenCalled();
  });

  it('says it was a conflict, and reloads, when someone else changed the contact', async () => {
    const { ApiError } = await import('@/lib/api/errors');
    api.update.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'stale'));
    await act(async () => {
      await hook.move(target(), { stage: 'qualified' });
    });
    expect(toasts()).toContain('Someone else changed this contact');
    expect(cached().lifecycleStage).toBe('new');
  });
});
