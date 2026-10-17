// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act, useReducer } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { initialState, wizardReducer, type WizardAction } from '../lib/state';
import { draft, templates, uuid } from '../testing';
import { SequenceCard } from './sequence-card';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const list = templates();
let latest = initialState();

function Harness({
  recurring = true,
  abTesting = false,
  start,
  issues = [],
}: {
  recurring?: boolean;
  abTesting?: boolean;
  start?: ReturnType<typeof draft>['templateSequence'];
  issues?: Array<{ path: string; code: never }>;
}) {
  const [state, dispatch] = useReducer(
    (s: ReturnType<typeof initialState>, a: WizardAction) => {
      latest = wizardReducer(s, a);
      return latest;
    },
    initialState(draft({ templateSequence: start ?? [] })),
  );
  return (
    <SequenceCard
      firstName="order_update"
      sequence={state.draft.templateSequence}
      recurring={recurring}
      abTesting={abTesting}
      templates={list}
      loading={false}
      issues={issues}
      dispatch={dispatch}
    />
  );
}

function mount(props: Parameters<typeof Harness>[0] = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <Harness {...props} />
      </NextIntlClientProvider>,
    );
  });
  return root;
}

const button = (label: string) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.textContent === label || b.getAttribute('aria-label') === label,
  ) as HTMLButtonElement | undefined;
const rows = () => document.querySelectorAll('[data-testid="sequence-row"]');
function choose(el: HTMLSelectElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const entry = (n: number) => ({ templateId: uuid(n), variables: {} });
const ids = () => latest.draft.templateSequence.map((e) => e.templateId);

afterEach(() => {
  document.body.innerHTML = '';
  latest = initialState();
});

describe('sequence card', () => {
  it('shows nothing for a schedule that is not recurring while the sequence is empty', () => {
    const root = mount({ recurring: false });
    expect(document.body.textContent).toBe('');
    act(() => root.unmount());
  });

  it("lists the draft's own template read only as template 1, and adds entries up to 10 in all", () => {
    const root = mount();
    expect(document.querySelector('[data-testid="sequence-first"]')!.textContent).toContain(
      'order_update',
    );
    expect(document.querySelector('[data-testid="sequence-first"] select')).toBeNull();
    expect(document.body.textContent).toContain('1 of 10 templates');
    for (let n = 1; n <= 9; n++) {
      act(() => button('Add a template')!.click());
      expect(rows()).toHaveLength(n);
    }
    expect(button('Add a template')!.disabled).toBe(true);
    expect(document.body.textContent).toContain('Limit reached: 10 templates.');
    act(() => root.unmount());
  });

  it('picks a template for an entry from the approved list', () => {
    const root = mount({ start: [{ templateId: null, variables: {} }] });
    choose(
      document.querySelector('[data-testid="sequence-row"] select') as HTMLSelectElement,
      uuid(2),
    );
    expect(ids()).toEqual([uuid(2)]);
    act(() => root.unmount());
  });

  it('moves entries up and down, with the first Up and the last Down disabled', () => {
    const root = mount({ start: [entry(1), entry(2), entry(3)] });
    expect(button('Move template 2 up')!.disabled).toBe(true);
    expect(button('Move template 4 down')!.disabled).toBe(true);
    act(() => button('Move template 2 down')!.click());
    expect(ids()).toEqual([uuid(2), uuid(1), uuid(3)]);
    act(() => button('Move template 4 up')!.click());
    expect(ids()).toEqual([uuid(2), uuid(3), uuid(1)]);
    act(() => root.unmount());
  });

  it('removes one entry, or all of them', () => {
    const root = mount({ start: [entry(1), entry(2), entry(3)] });
    act(() => button('Remove template 3')!.click());
    expect(ids()).toEqual([uuid(1), uuid(3)]);
    act(() => button('Remove all')!.click());
    expect(rows()).toHaveLength(0);
    expect(button('Remove all')).toBeUndefined();
    act(() => root.unmount());
  });

  it('is locked with an A/B test, saying why, but can still be emptied', () => {
    const root = mount({ abTesting: true, start: [entry(1), entry(2)] });
    expect(document.body.textContent).toContain('cannot be used together with an A/B test');
    expect(button('Add a template')!.disabled).toBe(true);
    expect(button('Move template 2 down')!.disabled).toBe(true);
    expect([...document.querySelectorAll('select')].every((s) => s.disabled)).toBe(true);
    expect(button('Remove all')!.disabled).toBe(false);
    act(() => button('Remove all')!.click());
    expect(rows()).toHaveLength(0);
    act(() => root.unmount());
  });

  it('stays visible, locked, when a sequence is left on a schedule that is not recurring', () => {
    const root = mount({ recurring: false, start: [entry(1)] });
    expect(document.body.textContent).toContain(
      'Only a recurring broadcast sends templates in turn',
    );
    expect(button('Add a template')!.disabled).toBe(true);
    act(() => button('Remove all')!.click());
    expect(document.body.textContent).toBe('');
    act(() => root.unmount());
  });

  it('shows the issue of an entry without a template', () => {
    const root = mount({
      start: [{ templateId: null, variables: {} }],
      issues: [
        { path: 'templateSequence.0.templateId', code: 'sequence_template_required' as never },
      ],
    });
    expect(document.querySelector('[role="alert"]')!.textContent).toContain(
      'Choose a template for every step of the order',
    );
    act(() => root.unmount());
  });
});
