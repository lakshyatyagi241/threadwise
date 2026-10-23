// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  canvas: vi.fn((_props?: unknown): null => null),
  toast: vi.fn(),
  mode: 'simple' as 'simple' | 'advanced',
  search: '',
  flowType: 'chat' as string,
  builder: 'simple' as string,
  pending: false,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: h.replace }),
  useSearchParams: () => new URLSearchParams(h.search),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => true,
}));
vi.mock('@crm/ui', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('../components/flows-screen', () => ({ FLASH_KEY: 'flb.flash' }));
vi.mock('../api/flows', () => ({
  flowsApi: {
    overview: () => Promise.resolve({ builderMode: h.mode }),
    get: () =>
      h.pending
        ? new Promise(() => undefined)
        : Promise.resolve({
            id: FLOW,
            flowType: h.flowType,
            builder: h.builder,
          }),
  },
}));
vi.mock('./builder-screen', () => ({ BuilderScreen: (p: unknown) => h.canvas(p) }));

import { BuilderRoute } from './builder-route';

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

async function mount(flowId?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <BuilderRoute flowId={flowId} />
      </QueryClientProvider>,
    );
  });
  await flush();
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  h.replace.mockClear();
  h.canvas.mockClear();
  h.mode = 'simple';
  h.search = '';
  h.flowType = 'chat';
  h.builder = 'simple';
  h.pending = false;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host.remove();
});

describe('BuilderRoute in a Simple workspace: a saved flow opens in the editor it belongs to', () => {
  it('sends a WhatsApp bot to the Simple builder', async () => {
    await mount(FLOW);
    expect(h.replace).toHaveBeenCalledWith(`/flows/simple/${FLOW}`);
    expect(h.canvas).not.toHaveBeenCalled();
  });

  it('sends a website chat bot to the Simple builder', async () => {
    h.flowType = 'web';
    await mount(FLOW);
    expect(h.replace).toHaveBeenCalledWith(`/flows/simple/${FLOW}`);
    expect(h.canvas).not.toHaveBeenCalled();
  });

  it('keeps a messaging flow built on the canvas on the canvas', async () => {
    h.builder = 'advanced';
    await mount(FLOW);
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.canvas).toHaveBeenCalled();
  });

  it('keeps a call flow on the canvas, even when opened without ?type=call', async () => {
    h.flowType = 'call';
    h.builder = 'advanced';
    await mount(FLOW);
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.canvas).toHaveBeenCalled();
  });

  it('a new WhatsApp bot is made in the Simple builder', async () => {
    await mount();
    expect(h.replace).toHaveBeenCalledWith('/flows/simple');
    expect(h.canvas).not.toHaveBeenCalled();
  });

  it('a new call (?type=call) stays on the canvas', async () => {
    h.search = 'type=call';
    await mount();
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.canvas).toHaveBeenCalled();
  });

  it('waits for the flow before choosing an editor, so the canvas never flashes for a bot', async () => {
    h.pending = true;
    await mount(FLOW);
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.canvas).not.toHaveBeenCalled();
  });
});

describe('BuilderRoute in an Advanced workspace', () => {
  it('opens a WhatsApp bot on the canvas (the workspace makes every flow an automation)', async () => {
    h.mode = 'advanced';
    await mount(FLOW);
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.canvas).toHaveBeenCalled();
  });
});
