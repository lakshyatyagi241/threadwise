// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiModelOption, CampaignAiGenerateResponse, MarketingMedia } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { loadMessages } from '@/i18n/messages';
import { aiGenerateCampaign, aiImageCampaign } from '../../api/campaigns';
import { EMPTY_FORM } from '../../lib/builder-model';
import { session } from '../../wizard/testing';
import { AiModal } from './ai-modal';
import { StepCompose } from './step-compose';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute('open');
};

vi.mock('../../api/campaigns', async (orig) => ({
  ...(await orig<typeof import('../../api/campaigns')>()),
  aiGenerateCampaign: vi.fn(),
  aiImageCampaign: vi.fn(),
}));
const text = vi.mocked(aiGenerateCampaign);
const image = vi.mocked(aiImageCampaign);

const COPY: CampaignAiGenerateResponse['campaign'] = {
  campaignName: 'spring',
  message: 'Hi {{name}}',
  footer: '',
  buttonText: '',
  buttonUrl: '',
  quickReplies: [],
};
const MEDIA: MarketingMedia = {
  url: 'https://cdn.test/ai.png',
  name: 'ai.png',
  mime: 'image/png',
  kind: 'image',
  size: 1234,
};
const OPENAI: AiModelOption = {
  value: 'gpt-4o-mini',
  provider: 'openai',
  providerName: 'OpenAI',
  source: 'platform',
};
const CLAUDE: AiModelOption = {
  value: 'claude-x',
  provider: 'anthropic',
  providerName: 'Anthropic',
  source: 'platform',
};

let root: Root;
const onApply = vi.fn();
const onImage = vi.fn();
const onClose = vi.fn();

function mount(over: { canAttach?: boolean } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(['camp', 'ai-models'], { data: [OPENAI, CLAUDE] });
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={qc}>
          <AiModal open onClose={onClose} onApply={onApply} onImage={onImage} {...over} />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
function setValue(el: HTMLElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;
const click = (el: HTMLElement) =>
  act(async () => {
    el.click();
  });
const checkbox = () => $<HTMLInputElement>('#ai-picture');
const alerts = () => [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
const fill = (model = 'openai:gpt-4o-mini') => {
  setValue($('#ai-model'), model);
  setValue($('#ai-business'), 'Bloomly');
};

beforeEach(() => {
  for (const m of [text, image, onApply, onImage, onClose]) m.mockReset();
  text.mockResolvedValue({ campaign: COPY, model: 'gpt-4o-mini' });
  image.mockResolvedValue({ image: MEDIA, model: 'gpt-image-1' });
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('Build with AI (campaign text), picture option', () => {
  it('is off, with a hint, until an OpenAI model is picked', () => {
    mount();
    expect(checkbox().disabled).toBe(true);
    expect(document.body.textContent).toContain('Pictures need an OpenAI key');
    fill('anthropic:claude-x');
    expect(checkbox().disabled).toBe(true);
    expect(document.body.textContent).toContain('Pictures need an OpenAI key');
    setValue($('#ai-model'), 'openai:gpt-4o-mini');
    expect(checkbox().disabled).toBe(false);
  });

  it('is off when the sender cannot carry a picture', () => {
    mount({ canAttach: false });
    fill();
    expect(checkbox().disabled).toBe(true);
    expect(document.body.textContent).toContain('sends text only');
  });

  it('offers three shapes once ticked', () => {
    mount();
    fill();
    act(() => checkbox().click());
    const sizes = [...$('#ai-picture-size').querySelectorAll('option')].map((o) => o.textContent);
    expect(sizes).toEqual(['Square', 'Landscape', 'Portrait']);
  });

  it('without the tick, writes the text only', async () => {
    mount();
    fill();
    await click(button('Generate campaign'));
    expect(image).not.toHaveBeenCalled();
    expect(onApply).toHaveBeenCalledWith(COPY);
    expect(onImage).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('with the tick, writes the text, then draws the picture from the same brief and attaches it', async () => {
    mount();
    fill();
    setValue($('#ai-product'), 'Spring bouquets');
    setValue($('#ai-offer'), '15% off');
    setValue($('#ai-tone'), 'friendly');
    act(() => checkbox().click());
    setValue($('#ai-picture-size'), 'landscape');
    await click(button('Generate campaign'));
    expect(image).toHaveBeenCalledWith({
      provider: 'openai',
      businessName: 'Bloomly',
      product: 'Spring bouquets',
      offer: '15% off',
      tone: 'Friendly',
      customPrompt: undefined,
      size: '1536x1024',
    });
    expect(onApply).toHaveBeenCalledWith(COPY);
    expect(onImage).toHaveBeenCalledWith(MEDIA);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the text and says so on its own line when the picture is refused; Retry draws only the picture', async () => {
    image.mockRejectedValueOnce(new ApiError(422, 'CAMP_AI_IMAGE_REFUSED', 'x'));
    mount();
    fill();
    act(() => checkbox().click());
    await click(button('Generate campaign'));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onImage).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      'The campaign text was filled in. Only the picture is missing.',
    );
    expect(alerts().join('|')).toContain('OpenAI refused to draw this picture');

    await click(button('Try the picture again'));
    expect(text).toHaveBeenCalledTimes(1);
    expect(image).toHaveBeenCalledTimes(2);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onImage).toHaveBeenCalledWith(MEDIA);
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    ['CAMP_AI_NO_KEY', 'Pictures need an OpenAI key, and none is enabled'],
    ['CAMP_AI_LIMIT_REACHED', 'used its AI allowance'],
    ['CAMP_AI_PROVIDER_FAILED', 'The picture service did not answer'],
    ['SOMETHING_ELSE', 'Could not create the picture'],
  ])('the picture failing with %s gets its own sentence', async (code, sentence) => {
    image.mockRejectedValue(new ApiError(422, code, 'x'));
    mount();
    fill();
    act(() => checkbox().click());
    await click(button('Generate campaign'));
    expect(alerts().join('|')).toContain(sentence);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('a failed text asks for no picture and shows the text error', async () => {
    text.mockRejectedValue(new ApiError(422, 'CAMP_AI_LIMIT_REACHED', 'x'));
    mount();
    fill();
    act(() => checkbox().click());
    await click(button('Generate campaign'));
    expect(image).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(alerts()).toEqual(['This workspace has used its AI allowance for the month.']);
  });
});

describe('the Attachment card adopts a picture that arrives from outside', () => {
  it('a form whose image address is filled in later opens on the image choice', async () => {
    const qc = new QueryClient();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    const form = { ...EMPTY_FORM, type: 'custom' as const, senderKey: 'baileys:1' };
    const view = (mediaUrl: string) => (
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={qc}>
          <SessionProvider session={session()}>
            <ToastProvider dismissLabel="Dismiss">
              <StepCompose
                form={{ ...form, mediaUrl }}
                patch={() => undefined}
                builder={undefined}
                catalog={undefined}
                engine="baileys"
                templates={[]}
              />
            </ToastProvider>
          </SessionProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
    act(() => r.render(view('')));
    expect($<HTMLSelectElement>('#camp-attach-type').value).toBe('none');
    act(() => r.render(view(MEDIA.url)));
    expect($<HTMLSelectElement>('#camp-attach-type').value).toBe('image');
    expect($<HTMLInputElement>('#camp-media').value).toBe(MEDIA.url);
    act(() => r.unmount());
  });
});
