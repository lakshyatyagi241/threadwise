// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};

const api = vi.hoisted(() => ({ generate: vi.fn(), apply: vi.fn() }));
vi.mock('../api/campaigns', () => ({
  useAiModels: () => ({
    isLoading: false,
    isError: false,
    data: [{ provider: 'anthropic', providerName: 'Anthropic', value: 'm1', source: 'platform' }],
  }),
  aiGenerateCampaign: api.generate,
  aiImageCampaign: vi.fn(),
}));

import { AiModal } from './builder/ai-modal';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'campaigns.json'), 'utf8'),
) as Record<string, unknown>;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  api.generate.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const setValue = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(el, v);
  el.dispatchEvent(
    new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
  );
};

describe('build with AI', () => {
  it('keeps the values and shows the error when the generate request fails', async () => {
    api.generate.mockRejectedValue(new ApiError(502, 'CAMP_AI_PROVIDER_FAILED', 'upstream'));
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <AiModal open onClose={vi.fn()} onApply={api.apply} />
        </NextIntlClientProvider>,
      );
    });
    const q = <T extends HTMLElement>(s: string) => host.querySelector<T>(s)!;
    await act(async () => setValue(q<HTMLSelectElement>('#ai-model'), 'anthropic:m1'));
    await act(async () => setValue(q<HTMLInputElement>('#ai-business'), 'Acme Bakery'));
    const button = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Generate campaign',
    )!;
    await act(async () => button.click());

    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('The AI provider did not answer. Try again in a moment.');
    expect(q<HTMLInputElement>('#ai-business').value).toBe('Acme Bakery');
    expect(api.apply).not.toHaveBeenCalled();
    // The button works again so the person can retry.
    expect(button.disabled).toBe(false);
  });
});
