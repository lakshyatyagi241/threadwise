// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  nodes: {} as Record<string, unknown>,
  refetch: vi.fn(),
}));
vi.mock('../api/hooks', () => ({ useFlowNodes: () => state.nodes }));

import { FlowNodeSelect } from './flow-node-select';

const en = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'faq-knowledge.json'), 'utf8'),
) as Record<string, unknown>;

const STEPS = [
  { id: 'trig-1', type: 'trigger', label: '' },
  { id: 'n-msg', type: 'message', label: 'Welcome' },
  { id: 'n-ask', type: 'ask', label: '' },
];
const FLOW = '00000000-0000-4000-8000-0000000000f1';

let root: Root;
let host: HTMLElement;
const onChange = vi.fn();

async function mount(props: Partial<Parameters<typeof FlowNodeSelect>[0]> = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <FlowNodeSelect flowId={FLOW} value={null} saved={null} onChange={onChange} {...props} />
      </NextIntlClientProvider>,
    );
  });
}
const select = () => host.querySelector('select')!;
const choose = (value: string) =>
  act(async () => {
    const el = select();
    // React tracks the value itself, so the native setter is used to make the change event real.
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  onChange.mockReset();
  state.refetch.mockReset();
  state.nodes = {
    isPending: false,
    isError: false,
    error: null,
    data: { data: STEPS },
    refetch: state.refetch,
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('FlowNodeSelect', () => {
  it('reports the chosen step, and null when the flow start is chosen again', async () => {
    await mount({ value: 'n-msg' });
    expect(select().value).toBe('n-msg');
    await choose('n-ask');
    expect(onChange).toHaveBeenLastCalledWith('n-ask');
    await choose('');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
  it('is labelled, so the keyboard and screen readers reach it by name', async () => {
    await mount();
    const label = host.querySelector(`label[for="${select().id}"]`);
    expect(label?.textContent).toBe('Go to');
  });
  it('the fix button for a gone step starts at the flow start and moves focus to the select', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });
    await mount({
      value: 'n-old',
      saved: { flowId: FLOW, flowNodeId: 'n-old', flowNodeLabel: null },
    });
    expect(host.textContent).toContain('The step this FAQ goes to is gone');
    const fix = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === "Start at the flow's start",
    )!;
    await act(async () => fix.click());
    expect(onChange).toHaveBeenCalledWith(null);
    await act(async () => void vi.advanceTimersByTime(50));
    expect(document.activeElement).toBe(select());
    vi.useRealTimers();
  });
  it('the retry button asks for the steps again', async () => {
    state.nodes = {
      isPending: false,
      isError: true,
      error: new Error('offline'),
      data: undefined,
      refetch: state.refetch,
    };
    await mount();
    expect(host.querySelector('select')).toBeNull();
    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!;
    await act(async () => retry.click());
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });
  it('shows a server problem on the field and marks the select invalid', async () => {
    await mount({ value: 'n-msg', invalid: true, error: 'Pick a step that is in this flow.' });
    expect(select().getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'Pick a step that is in this flow.',
    );
  });
});
