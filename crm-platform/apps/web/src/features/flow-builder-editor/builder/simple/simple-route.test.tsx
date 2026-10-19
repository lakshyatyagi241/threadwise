// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  screen: vi.fn((_props?: unknown): null => null),
  mode: 'advanced' as 'simple' | 'advanced',
  flowType: 'chat' as string,
  pending: false,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: h.replace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => true,
}));
vi.mock('../../api/flows', () => ({
  flowsApi: {
    overview: () => Promise.resolve({ builderMode: h.mode }),
    get: () =>
      h.pending
        ? new Promise(() => undefined)
        : Promise.resolve({ id: '11111111-1111-4111-8111-111111111111', flowType: h.flowType }),
  },
}));
vi.mock('./simple-screen', () => ({ SimpleScreen: (p: unknown) => h.screen(p) }));

import { SimpleRoute } from './simple-route';

const FLOW = '11111111-1111-4111-8111-111111111111';

let host: HTMLElement;
let root: Root;

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <SimpleRoute flowId={FLOW} />
      </QueryClientProvider>,
    );
  });
  await flush();
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  h.replace.mockClear();
  h.screen.mockClear();
  h.mode = 'advanced';
  h.flowType = 'chat';
  h.pending = false;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host.remove();
});

describe('SimpleRoute in an Advanced workspace', () => {
  it('sends a call flow to the Advanced canvas', async () => {
    h.flowType = 'call';
    await mount();
    expect(h.replace).toHaveBeenCalledWith(`/flows/builder/${FLOW}`);
    expect(h.screen).not.toHaveBeenCalled();
  });

  it('keeps a WhatsApp bot on the Simple builder', async () => {
    h.flowType = 'chat';
    await mount();
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.screen).toHaveBeenCalled();
  });

  it('keeps a website chat bot on the Simple builder', async () => {
    h.flowType = 'web';
    await mount();
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.screen).toHaveBeenCalled();
  });

  it('waits for the flow type before deciding, so a bot never bounces', async () => {
    h.pending = true;
    await mount();
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.screen).not.toHaveBeenCalled();
  });
});

describe('SimpleRoute in a Simple workspace', () => {
  it('never redirects, whatever the flow type', async () => {
    h.mode = 'simple';
    h.flowType = 'call';
    await mount();
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.screen).toHaveBeenCalled();
  });
});
