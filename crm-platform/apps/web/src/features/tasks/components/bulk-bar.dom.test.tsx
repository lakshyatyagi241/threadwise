// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LONG = 'thjis is donethjis is donethjis is donethjis is donethjis is donethjis is doneth';
const outcomes = vi.hoisted(() => ({
  list: [] as Array<{ id: string; name: string; isActive: boolean }>,
}));
vi.mock('../api/hooks', () => ({ useTaskOutcomes: () => ({ data: outcomes.list }) }));
vi.mock('@/features/sales-activities', () => ({
  useActivitySettings: () => ({ loaded: true, outcomesEnabled: true }),
}));

import { BulkBar } from './bulk-bar';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  outcomes.list = [
    { id: 'o1', name: 'Interested', isActive: true },
    { id: 'o2', name: LONG, isActive: true },
  ];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const draw = (completed: boolean, onComplete = vi.fn()) => {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')}>
        <BulkBar
          count={2}
          busy={false}
          members={[]}
          meId="m"
          canUpdate
          canDelete
          completed={completed}
          onComplete={onComplete}
          onAssign={vi.fn()}
          onDelete={vi.fn()}
          onClear={vi.fn()}
        />
      </NextIntlClientProvider>,
    ),
  );
  return onComplete;
};
const button = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const labels = () => [...host.querySelectorAll('button')].map((b) => b.textContent?.trim());

describe('tasks BulkBar', () => {
  it('offers Complete and Complete with task outcome on an open tab', () => {
    draw(false);
    expect(labels()).toContain('Complete');
    expect(labels()).toContain('Complete with task outcome');
    expect(labels()).not.toContain('Re-open');
  });

  it('offers Re-open and Re-open with task outcome on the Completed tab', () => {
    draw(true);
    expect(labels()).toContain('Re-open');
    expect(labels()).toContain('Re-open with task outcome');
    expect(labels()).not.toContain('Complete');
  });

  it('the plain button acts without an outcome; the menu passes the picked one and clamps long names', () => {
    const onComplete = draw(true);
    act(() => button('Re-open')!.click());
    expect(onComplete).toHaveBeenLastCalledWith();

    act(() => button('Re-open with task outcome')!.click());
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    const long = items.find((i) => i.textContent?.startsWith('thjis'))!;
    expect(long.textContent!.length).toBeLessThan(LONG.length);
    expect(long.querySelector('span[title]')?.getAttribute('title')).toBe(LONG);
    act(() => (items.find((i) => i.textContent === 'Interested') as HTMLElement).click());
    expect(onComplete).toHaveBeenLastCalledWith('o1');
  });

  it('leaves out the outcome menu when the workspace has no outcomes', () => {
    outcomes.list = [];
    draw(false);
    expect(labels()).not.toContain('Complete with task outcome');
  });
});
