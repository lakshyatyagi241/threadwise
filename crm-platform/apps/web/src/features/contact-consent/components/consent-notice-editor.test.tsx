// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsentNotice } from '@crm/contracts';
import { button, click, mount, text, type, type Mounted } from '../testing';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  notice: null as unknown,
  saved: [] as unknown[],
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('../api/service', () => ({
  consentApi: {
    notice: () => Promise.resolve(state.notice),
    saveNotice: (_s: string, _r: string, body: Record<string, unknown>) => {
      state.saved.push(body);
      return Promise.resolve({
        ...(state.notice as object),
        ...body,
        version: ((state.notice as ConsentNotice).version ?? 0) + 1,
      });
    },
  },
}));

import { ConsentNoticeEditor } from './consent-notice-editor';

const empty: ConsentNotice = {
  scope: 'widget',
  ref: 'w1',
  enabled: false,
  text: '',
  url: null,
  channels: [],
  version: 0,
  updatedAt: null,
};

let m: Mounted | null = null;
beforeEach(() => {
  state.perms = new Set(['settings.consent.manage']);
  state.notice = empty;
  state.saved = [];
});
afterEach(async () => {
  await m?.unmount();
  m = null;
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('the consent line editor', () => {
  it('shows nothing to people who may not manage consent', async () => {
    state.perms = new Set();
    m = await mount(<ConsentNoticeEditor scope="widget" refId="w1" />, { client: client() });
    await flush();
    expect(m.host.querySelector('[data-testid="consent-notice-editor"]')).toBeNull();
  });

  it('asks to save the record first when there is nothing to attach the line to', async () => {
    m = await mount(<ConsentNoticeEditor scope="booking" refId="" disabled />, {
      client: client(),
    });
    expect(m.host.textContent).toContain(text('notice.saveFirst'));
  });

  it('saves the wording and the link as a new version and says which', async () => {
    m = await mount(<ConsentNoticeEditor scope="widget" refId="w1" />, { client: client() });
    await flush();
    await flush();
    expect(m.host.textContent).toContain(text('notice.noVersion'));
    const save = button(m.host, text('notice.save'));
    expect(save.disabled).toBe(true);

    await type(m.host.querySelector('textarea')!, 'Send me offers.');
    await type(m.host.querySelector('input[type="url"]')!, 'https://example.com/privacy');
    await click(m.host.querySelector('[role="switch"]')!);
    expect(button(m.host, text('notice.save')).disabled).toBe(false);
    await click(button(m.host, text('notice.save')));
    await flush();
    expect(state.saved).toEqual([
      {
        enabled: true,
        text: 'Send me offers.',
        url: 'https://example.com/privacy',
        channels: [],
      },
    ]);
  });

  it('will not save a line that is switched on without its wording', async () => {
    m = await mount(<ConsentNoticeEditor scope="widget" refId="w1" />, { client: client() });
    await flush();
    await flush();
    await click(m.host.querySelector('[role="switch"]')!);
    expect(m.host.textContent).toContain(text('notice.textRequired'));
    expect(button(m.host, text('notice.save')).disabled).toBe(true);
  });

  it('a store can count its checkbox for WhatsApp too, and only a store is offered that', async () => {
    state.notice = { ...empty, scope: 'commerce', ref: 'shopify:s1' };
    m = await mount(<ConsentNoticeEditor scope="commerce" refId="shopify:s1" />, {
      client: client(),
    });
    await flush();
    await flush();
    expect(m.host.textContent).toContain(text('notice.whatsappToo'));
    await unmountAndMount('widget');
    expect(m.host.textContent).not.toContain(text('notice.whatsappToo'));
  });
});

async function unmountAndMount(scope: 'widget') {
  await m?.unmount();
  state.notice = { ...empty, scope };
  m = await mount(<ConsentNoticeEditor scope={scope} refId="w1" />, { client: client() });
  await flush();
  await flush();
}
