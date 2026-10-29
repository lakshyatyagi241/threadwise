// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { ApiError } from '@/lib/api/errors';
import { uploadTemplateMedia } from '../api/media';
import type { FormState } from '../lib/form-model';
import { HeaderSection } from './header-section';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../api/media', () => ({ uploadTemplateMedia: vi.fn() }));
const upload = vi.mocked(uploadTemplateMedia);

const CONN = '00000000-0000-4000-8000-0000000000a1';
const MB = 1024 * 1024;
const jpeg = (size: number) =>
  new File([new Uint8Array(size)], 'header.jpg', { type: 'image/jpeg' });

const state = {
  connectionId: CONN,
  headerKind: 'image',
  headerText: '',
  headerFileName: '',
  headerSampleUrl: '',
  headerPreviewUrl: '',
} as unknown as FormState;

let host: HTMLDivElement;
let root: Root;

function renderSection() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
          <HeaderSection state={state} onKind={vi.fn()} onText={vi.fn()} onUploaded={vi.fn()} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
}

// jsdom cannot build a FileList, so the file is set on the input and the change event is dispatched.
async function pick(file: File) {
  const input = host.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const text = () => host.textContent ?? '';

beforeEach(() => {
  upload.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('header media pick', () => {
  it('says plainly when the provider is limiting uploads, and when it is not answering', async () => {
    upload.mockRejectedValueOnce(
      new ApiError(
        429,
        'RATE_LIMITED',
        'The WhatsApp provider is limiting uploads right now.',
        'r3',
      ),
    );
    renderSection();
    await pick(jpeg(1024));
    expect(text()).toContain('the WhatsApp provider is limiting file uploads');
    expect(text()).not.toContain('Something went wrong');

    upload.mockRejectedValueOnce(
      new ApiError(503, 'WABA_PROVIDER_UNAVAILABLE', 'The provider is down', 'r4'),
    );
    await pick(jpeg(2048));
    expect(text()).toContain('The WhatsApp provider is not answering right now');
  });

  it('names the real problem of a refused upload, never the bare generic line', async () => {
    upload.mockRejectedValueOnce(new ApiError(413, 'UNKNOWN', 'Request failed with status 413'));
    renderSection();
    await pick(jpeg(1024));
    expect(text()).toContain('This picture is too big. WhatsApp accepts a picture up to 5 MB.');
    expect(text()).not.toContain('Something went wrong');

    upload.mockRejectedValueOnce(
      new ApiError(
        422,
        'TPL_META_REJECTED',
        'Meta did not accept the file: Invalid image dimensions',
        'r2',
      ),
    );
    await pick(jpeg(2048));
    expect(text()).toContain('The file could not be uploaded');
    expect(text()).toContain('Invalid image dimensions');
  });

  it('a new pick clears the error the last upload left', async () => {
    upload.mockRejectedValueOnce(
      new ApiError(422, 'VALIDATION_FAILED', 'Request payload failed validation', 'r1', [
        { path: 'connectionId', message: 'Invalid uuid' },
      ]),
    );
    renderSection();
    await pick(jpeg(1024));
    expect(text()).toContain('The file could not be uploaded');

    await pick(jpeg(Math.round(5.5 * MB)));
    expect(text()).not.toContain('The file could not be uploaded');
    expect(text()).toContain('is 5.5 MB');
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('a pick while an upload is running is ignored', async () => {
    upload.mockReturnValue(new Promise(() => undefined));
    renderSection();
    await pick(jpeg(1024));
    await pick(jpeg(1024));
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
