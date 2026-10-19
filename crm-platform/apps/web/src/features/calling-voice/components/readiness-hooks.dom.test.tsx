// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiFetch: api.fetch }));

import { KEYS } from '../api/calling';
import { READINESS_KEYS, useCheckReadiness } from '../api/readiness';
import { useErrorText } from './use-error-text';

const NUMBER = '4f0c1f6e-5b0b-4a52-9d0a-0c4a1d0a6b11';
let host: HTMLElement;
let root: Root;
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mountWith(client: QueryClient, ui: ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}

describe('a readiness check refreshes only what it changed', () => {
  const run = async (answerEnabled: boolean) => {
    const client = new QueryClient();
    client.setQueryData(READINESS_KEYS.list, { rows: [] });
    client.setQueryData(KEYS.numbers, {
      rows: [{ id: NUMBER, callingEnabled: false }],
    });
    client.setQueryData(['call', 'pending'], { calls: [] });
    const invalidated: unknown[] = [];
    const real = client.invalidateQueries.bind(client);
    client.invalidateQueries = ((f: { queryKey: unknown }) => {
      invalidated.push(f.queryKey);
      return real(f as never);
    }) as typeof client.invalidateQueries;
    api.fetch.mockResolvedValue({ numberId: NUMBER, callingEnabled: answerEnabled });
    let mutate!: ReturnType<typeof useCheckReadiness>['mutateAsync'];
    function Probe() {
      mutate = useCheckReadiness().mutateAsync;
      return null;
    }
    mountWith(client, <Probe />);
    await act(async () => {
      await mutate({ id: NUMBER, source: 'health' });
    });
    return invalidated;
  };

  it('the checklists, and the numbers only when the local switch moved, never every call query', async () => {
    const same = await run(false);
    expect(same).toEqual([READINESS_KEYS.list]);
    const moved = await run(true);
    expect(moved).toEqual([READINESS_KEYS.list, KEYS.numbers]);
  });
});

describe('the words of a refusal', () => {
  const refusal = new ApiError(
    422,
    'CALL_META_REFUSED',
    'Meta refused the call (400): Receiver uncallable',
    undefined,
    [{ path: 'reason', message: 'receiver_uncallable' }],
  );
  let text!: ReturnType<typeof useErrorText>;
  function Probe() {
    text = useErrorText();
    return null;
  }

  it("gives the reason and Meta's own sentence for dial, toggle and permission, and not for the other actions", () => {
    mountWith(new QueryClient(), <Probe />);
    const withReason = text(refusal, { reasons: true });
    expect(withReason).toContain('cannot receive calls');
    expect(withReason).toContain('Receiver uncallable');
    // Accept, decline, hang up: the server's own sentence, not the card's reason.
    const plain = text(refusal);
    expect(plain).not.toContain('cannot receive calls');
    expect(plain).toContain('Receiver uncallable');
  });
});
