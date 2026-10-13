// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mutate = vi.hoisted(() => vi.fn());
const pending = vi.hoisted(() => ({ isPending: false, isError: false, error: null as unknown }));
vi.mock('../api/call-logs', () => ({
  usePlayback: () => ({ mutate, ...pending }),
}));

import { RecordingPlayer } from './recording-player';

const CALL = '4f0c1f6e-5b0b-4a52-9d0a-0c4a1d0a6b11';
let host: HTMLElement;
let root: Root;

function mount(canPlay = true, locale = 'en') {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider
        locale={locale}
        messages={loadMessages(locale)}
        timeZone="UTC"
        onError={(e) => {
          throw e;
        }}
      >
        <RecordingPlayer callId={CALL} canPlay={canPlay} />
      </NextIntlClientProvider>,
    );
  });
}

/** What the server answers: a link that works for five minutes. */
const link = (token: string, ttlMs = 300_000) => ({
  url: `/v2/media/${token}`,
  expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  mime: 'audio/webm',
});
const answerWith = (...links: Array<ReturnType<typeof link>>) => {
  mutate.mockImplementation((_id: string, opts: { onSuccess: (l: unknown) => void }) => {
    const next = links.shift();
    if (next) act(() => opts.onSuccess(next));
  });
};

beforeEach(() => {
  mutate.mockReset();
  pending.isPending = false;
  pending.isError = false;
  pending.error = null;
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const play = () => host.querySelector('button') as HTMLButtonElement;
const audio = () => host.querySelector('audio');

describe('the recording player', () => {
  it('asks for nothing until Play is pressed, and always shows the consent line', () => {
    mount();
    expect(mutate).not.toHaveBeenCalled();
    expect(audio()).toBeNull();
    expect(host.querySelector('[role="note"]')?.textContent).toBe('This call was recorded.');
    expect(play().textContent).toContain('Play recording');
  });

  it('Play asks once for a link and then shows a labelled audio element on the same-origin proxy', () => {
    answerWith(link('tok-one'));
    mount();
    act(() => play().click());
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toBe(CALL);
    const el = audio()!;
    expect(el.getAttribute('src')).toBe('/api/v2/media/tok-one');
    expect(el.getAttribute('aria-label')).toBe('Call recording');
    expect(el.hasAttribute('controls')).toBe(true);
    expect(host.textContent).toContain('This link works until');
    expect(host.querySelector('button')).toBeNull(); // the Play button is gone once the player is there
  });

  it('a link that ran out while the person was away is renewed once, and playing carries on', () => {
    // The first link is already past its time when the browser fails to read more of it.
    answerWith(link('old', -5_000), link('fresh'));
    mount();
    act(() => play().click());
    act(() => {
      audio()!.dispatchEvent(new Event('error'));
    });
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(audio()!.getAttribute('src')).toBe('/api/v2/media/fresh');
    expect(host.textContent).not.toContain('could not be played');
  });

  it('a link that is still good but fails is not renewed in a loop: the person is told, and can retry', () => {
    answerWith(link('good'), link('again'));
    mount();
    act(() => play().click());
    act(() => {
      audio()!.dispatchEvent(new Event('error'));
    });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('The recording could not be played.');
    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!;
    act(() => retry.click());
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(audio()!.getAttribute('src')).toBe('/api/v2/media/again');
  });

  it('without the right to play, the recording is described and no request is ever made', () => {
    mount(false);
    expect(host.textContent).toContain('do not have permission to play recordings');
    expect(host.querySelector('button')).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal in words', () => {
    pending.isError = true;
    pending.error = new ApiError(422, 'PLAN_FEATURE_LOCKED', 'locked');
    mount();
    expect(host.textContent).toContain('Your plan does not include WhatsApp calling.');
  });

  it('is available in Arabic', () => {
    mount(true, 'ar');
    expect(host.textContent).toMatch(/[؀-ۿ]/);
  });
});
