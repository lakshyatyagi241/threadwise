// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { button, click, mount, text, type Mounted } from '../testing';
import { UnsubscribePage } from './unsubscribe-page';

const TOKEN = 'abcdefghijklmnop.qrstuvwxyz0123456789';
let m: Mounted | null = null;
const calls: Array<{ url: string; method: string }> = [];

function fakeFetch(first: { status: number; body?: unknown }, then = { status: 200 }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      const r = method === 'GET' ? first : then;
      return new Response(JSON.stringify((r as { body?: unknown }).body ?? { ok: true }), {
        status: r.status,
      });
    }),
  );
}

beforeEach(() => {
  calls.length = 0;
});
afterEach(async () => {
  await m?.unmount();
  m = null;
  vi.unstubAllGlobals();
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));

describe.each(['en', 'ar'])('the unsubscribe page (%s)', (locale) => {
  it('asks first, unsubscribes only when the button is pressed, then confirms', async () => {
    fakeFetch({ status: 200, body: { valid: true, unsubscribed: false } });
    m = await mount(<UnsubscribePage token={TOKEN} />, { locale });
    await settle();
    expect(calls).toEqual([{ url: `/api/public/consent/${TOKEN}`, method: 'GET' }]);
    expect(m.host.textContent).toContain(text('unsubscribe.intro', locale));
    await click(button(m.host, text('unsubscribe.confirm', locale)));
    await settle();
    expect(calls.at(-1)).toEqual({ url: `/api/public/consent/${TOKEN}`, method: 'POST' });
    expect(m.host.textContent).toContain(text('unsubscribe.doneBody', locale));
  });

  it('says so when the person is already unsubscribed', async () => {
    fakeFetch({ status: 200, body: { valid: true, unsubscribed: true } });
    m = await mount(<UnsubscribePage token={TOKEN} />, { locale });
    await settle();
    expect(m.host.textContent).toContain(text('unsubscribe.already', locale));
    expect(m.host.querySelector('button')).toBeNull();
  });

  it('shows the invalid-link page for a link the server does not know', async () => {
    fakeFetch({ status: 404 });
    m = await mount(<UnsubscribePage token={TOKEN} />, { locale });
    await settle();
    expect(m.host.textContent).toContain(text('unsubscribe.invalidTitle', locale));
  });
});
