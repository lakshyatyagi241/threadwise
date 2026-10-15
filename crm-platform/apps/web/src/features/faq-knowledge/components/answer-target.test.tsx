// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDraft, type FaqDraft } from '../lib/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ nodeCalls: [] as string[] }));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => true,
}));
vi.mock('../api/hooks', () => ({
  useFlowNodes: (id: string | null) => {
    if (id) state.nodeCalls.push(id);
    return {
      isPending: false,
      isError: false,
      data: { data: [{ id: 'n1', type: 'message', label: 'Hello' }] },
    };
  },
  useFlowOptions: () => ({
    isPending: false,
    isError: false,
    data: {
      data: [
        { id: 'this', name: 'Support bot', isPublished: true, isActive: true },
        { id: 'other', name: 'Billing bot', isPublished: true, isActive: true },
      ],
    },
  }),
}));

import { AnswerTarget } from './answer-target';
import { FaqFlowProvider } from './faq-flow';

const en = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'faq-knowledge.json'), 'utf8'),
) as Record<string, unknown>;

let host: HTMLElement;
let root: Root;
const patches: Array<Partial<FaqDraft>> = [];

async function mount(draft: FaqDraft, readOnly = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <FaqFlowProvider flowId="this" flowName="Support bot">
          <AnswerTarget
            draft={draft}
            entry={null}
            readOnly={readOnly}
            flowMissing={false}
            onChange={(p) => patches.push(p)}
          />
        </FaqFlowProvider>
      </NextIntlClientProvider>,
    );
  });
}
const radios = () => [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')];

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  patches.length = 0;
  state.nodeCalls.length = 0;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const thisFlowDraft = (): FaqDraft => ({
  ...emptyDraft(),
  answerType: 'flow',
  flowId: 'this',
  flowName: 'Support bot',
});

describe('"Go to a step"', () => {
  it("defaults to a step of this flow and lists this flow's steps", async () => {
    await mount(thisFlowDraft());
    expect(radios().map((r) => r.checked)).toEqual([true, false]);
    expect(host.textContent).toContain('A step of this flow');
    expect(host.textContent).toContain('Send message · Hello');
    expect(state.nodeCalls).toContain('this');
    // The flow picker is only for another flow.
    expect(host.querySelector('input[type="search"]')).toBeNull();
  });

  it('switching to another flow clears the target and offers the other flows, never this one', async () => {
    await mount(thisFlowDraft());
    await act(async () => radios()[1]!.click());
    expect(patches.at(-1)).toEqual({ flowId: null, flowName: null, flowNodeId: null });
    expect(host.querySelector('input[type="search"]')).not.toBeNull();
    expect(host.textContent).toContain('Billing bot');
    expect(host.textContent).not.toContain('Support bot ·');
    const options = [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options.some((o) => o?.includes('Support bot'))).toBe(false);
  });

  it("picking another flow lists that flow's steps and clears the old step", async () => {
    await mount({ ...thisFlowDraft(), flowNodeId: 'n1' });
    await act(async () => radios()[1]!.click());
    const pick = [...host.querySelectorAll('[role="option"] button')].find((b) =>
      b.textContent?.includes('Billing bot'),
    )!;
    await act(async () => (pick as HTMLElement).click());
    expect(patches.at(-1)).toEqual({ flowId: 'other', flowName: 'Billing bot', flowNodeId: null });
  });

  it('opens on "another flow" for an FAQ that points elsewhere', async () => {
    await mount({ ...thisFlowDraft(), flowId: 'other', flowName: 'Billing bot' });
    expect(radios().map((r) => r.checked)).toEqual([false, true]);
    expect(state.nodeCalls).toContain('other');
  });

  it('going back to this flow resets the target to this flow', async () => {
    await mount({ ...thisFlowDraft(), flowId: 'other', flowName: 'Billing bot' });
    await act(async () => radios()[0]!.click());
    expect(patches.at(-1)).toEqual({ flowId: 'this', flowName: 'Support bot', flowNodeId: null });
  });

  it('a read-only viewer sees the target as text, with no controls', async () => {
    await mount(thisFlowDraft(), true);
    expect(host.textContent).toContain('A step of this flow (Support bot)');
    expect(radios()).toHaveLength(0);
  });
});
