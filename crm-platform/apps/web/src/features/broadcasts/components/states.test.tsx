import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContactResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { uploadMarketingMedia } from '../api/marketing-media';
import { AudiencePicker } from './audience-picker';
import { UploadMediaButton } from './upload-media-button';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'broadcasts.json'), 'utf8'),
) as Record<string, unknown>;
const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

const none = () => undefined;
const props = {
  tags: [],
  groups: [],
  segments: [],
  contacts: [] as ContactResponse[],
  contactsDenied: false,
  filter: {},
  onFilter: none,
  selectedTags: [],
  selectedGroups: [],
  selectedSegments: [],
  selectedContacts: [],
  onTags: none,
  onGroups: none,
  onSegments: none,
  onContacts: none,
};

describe('audience picker states', () => {
  it('shows the empty state with the primary action when there are no contacts yet', () => {
    const out = html(<AudiencePicker {...props} />);
    expect(out).toContain('No contacts yet.');
    expect(out).toContain('Add some →');
    expect(out).toContain('href="/contacts"');
    expect(out).not.toContain('Clear filters');
  });

  it('offers a way to clear the filters when the filters match nothing', () => {
    const out = html(<AudiencePicker {...props} filter={{ tagId: 't1' }} />);
    expect(out).toContain('Clear filters');
    // A cleared filter offers nothing to clear.
    expect(html(<AudiencePicker {...props} />)).not.toContain('Clear filters');
  });
});

describe('upload media button states', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders no error alert and an enabled button before any upload', () => {
    const out = html(<UploadMediaButton onUploaded={none} />);
    expect(out).toContain('Upload a file');
    expect(out).not.toContain('role="alert"');
    expect(out).not.toContain('disabled=""');
  });

  it('keeps the values: the upload request rejects with an ApiError the button turns into its alert (alert needs a click, so only the api layer is checked)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        headers: new Headers(),
        text: async () => '',
      })),
    );
    await expect(uploadMarketingMedia(new File(['x'], 'a.png'))).rejects.toBeInstanceOf(ApiError);
  });
});
