import { describe, expect, it, vi } from 'vitest';
import { formDefinitionSchema, formLiveSettingsSchema } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { renderAccount } from '@/features/auth-registration-security/account/render-test-utils';
import { ApiError } from '@/lib/api/errors';
import { checkOrigin } from '../lib/share';
import type { FormDetail } from '../lib/types';
import type { BuilderTabProps } from './builder-types';

const formAction = vi.hoisted(() => vi.fn());
vi.mock('../api/forms', () => ({ formAction }));

import { ShareTab, rotateKey, shareNotice } from './share-tab';

const ID = '5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d11';
const HOSTED = 'https://app.example.com/f/AbCdEfGhIjKlMnOpQrStUv';
const SCRIPT =
  '<script src="https://api.example.com/form-embed/AbCdEfGhIjKlMnOpQrStUv/embed.js" async></script>';
const IFRAME =
  '<iframe src="https://app.example.com/f/AbCdEfGhIjKlMnOpQrStUv" width="100%"></iframe>';

const draft = formDefinitionSchema.parse({
  title: 'Contact us',
  steps: [{ id: 's1', blocks: [] }],
});

function detail(over: Partial<FormDetail> = {}): FormDetail {
  return {
    id: ID,
    name: 'Contact us',
    status: 'published',
    publicKey: 'AbCdEfGhIjKlMnOpQrStUv',
    publishedVersion: 2,
    publishedAt: '2026-10-01T00:00:00.000Z',
    hasUnpublishedChanges: false,
    views: 0,
    submissions: 0,
    needsReview: 0,
    lastSubmissionAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    rowVersion: 4,
    draft,
    settings: formLiveSettingsSchema.parse({}),
    share: {
      hostedUrl: HOSTED,
      embedScriptUrl: 'https://api.example.com/form-embed/AbCdEfGhIjKlMnOpQrStUv/embed.js',
      scriptSnippet: SCRIPT,
      iframeSnippet: IFRAME,
    },
    ...over,
  };
}

function props(over: Partial<BuilderTabProps> = {}, origins: string[] = []): BuilderTabProps {
  const form = over.form ?? detail();
  return {
    form,
    draft,
    setDraft: () => undefined,
    live: formLiveSettingsSchema.parse({ allowedOrigins: origins }),
    patchLive: () => undefined,
    name: form.name,
    setName: () => undefined,
    canEdit: true,
    properties: [],
    onFormChange: () => undefined,
    busy: false,
    ...over,
  };
}

const render = (p: BuilderTabProps, locale: 'en' | 'ar' = 'en') =>
  renderAccount(
    <ToastProvider>
      <ShareTab {...p} />
    </ToastProvider>,
    { locale },
  );

describe('Share tab: status', () => {
  it('tells a draft form that the link does not work until it is published', () => {
    const html = render(props({ form: detail({ status: 'draft', publishedVersion: null }) }));
    expect(html).toContain('Publish the form to make this link work');
    expect(html).not.toContain('This form is live');
  });

  it('treats a published status with no version as not yet published', () => {
    expect(shareNotice({ status: 'published', publishedVersion: null })).toBe('draft');
  });

  it('says closed for a paused form, archived for an archived one, live with the version otherwise', () => {
    expect(render(props({ form: detail({ status: 'paused' }) }))).toContain('This form is closed');
    expect(render(props({ form: detail({ status: 'archived' }) }))).toContain(
      'This form is archived',
    );
    const live = render(props());
    expect(live).toContain('This form is live');
    expect(live).toContain('Visitors see version 2');
  });
});

describe('Share tab: link, QR and snippets', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`shows the hosted link, the QR code and both snippets with copy buttons in ${locale}`, () => {
      const html = render(props(), locale);
      expect(html).toContain(`value="${HOSTED}"`);
      expect(html).toMatch(/<a [^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
      expect(html).toContain('<svg');
      // the visible text of every action
      const copy = locale === 'en' ? ['Copy link', 'Copy code'] : ['نسخ الرابط', 'نسخ الكود'];
      expect(html).toContain(copy[0]!);
      // script, iframe, popup code and the popup button
      expect(html.split(copy[1]!).length - 1).toBeGreaterThanOrEqual(2);
      expect(html).toContain(locale === 'en' ? 'Download PNG' : 'تنزيل PNG');
      expect(html).toContain(locale === 'en' ? 'Download SVG' : 'تنزيل SVG');
      // code stays left to right whatever the page direction is
      expect(html.match(/<pre dir="ltr"/g)?.length).toBe(4);
      expect(html).toContain('embed.js');
      expect(html).toContain('&lt;iframe');
      expect(html).toContain('data-forms-mode=&quot;popup&quot;');
    });
  }

  it('uses only logical spacing and alignment classes so Arabic mirrors correctly', () => {
    const html = render(props({}, ['https://www.example.com']));
    const classes = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/));
    const physical = classes.filter((c) =>
      /^(-?(ml|mr|pl|pr|left|right)-|text-(left|right))/.test(c),
    );
    expect(physical).toEqual([]);
  });

  it('ties every labelled input to its label', () => {
    const html = render(props({}, ['https://www.example.com']));
    for (const m of html.matchAll(/<input[^>]*\bid="([^"]+)"/g)) {
      expect(html, m[1]).toContain(`for="${m[1]}"`);
    }
  });
});

describe('Share tab: allowed websites', () => {
  it('explains that none means the public link only', () => {
    const html = render(props());
    expect(html).toContain('works on its public link only');
    expect(html).toContain('0 of 20');
  });

  it('lists each allowed website with a remove button named after it', () => {
    const html = render(props({}, ['https://www.example.com', 'https://*.shop.example.com']));
    expect(html).toContain('https://*.shop.example.com');
    expect(html).toContain('aria-label="Remove https://www.example.com"');
    expect(html).toContain('2 of 20');
    expect(html).not.toContain('works on its public link only');
  });

  it('accepts exact and one-level wildcard origins and refuses the rest, with a reason for each', () => {
    expect(checkOrigin('https://Example.com/', [])).toEqual({
      ok: true,
      value: 'https://example.com',
    });
    expect(checkOrigin('https://*.example.com', [])).toEqual({
      ok: true,
      value: 'https://*.example.com',
    });
    expect(checkOrigin('', [])).toEqual({ ok: false, issue: 'empty' });
    expect(checkOrigin('*', [])).toEqual({ ok: false, issue: 'invalid' });
    expect(checkOrigin('https://example.com/path', [])).toEqual({ ok: false, issue: 'invalid' });
    expect(checkOrigin('http://example.com', [])).toEqual({ ok: false, issue: 'invalid' });
    expect(checkOrigin('https://example.com', ['https://example.com'])).toEqual({
      ok: false,
      issue: 'duplicate',
    });
  });
});

describe('Share tab: rotate key', () => {
  it('is closed until asked: no confirmation text in the page', () => {
    const html = render(props());
    expect(html).toContain('Rotate key');
    // the dialog element is in the page but not open, so nothing is shown or announced
    expect(html).toMatch(/<dialog(?![^>]*\bopen)/);
  });

  it('is disabled when the person cannot edit, and says so', () => {
    const html = render(props({ canEdit: false }));
    expect(html).toContain('You can view these settings but not change them.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Rotate key<\/button>/);
    expect(html.match(/<input[^>]*placeholder="https:\/\/www\.example\.com"[^>]*>/)?.[0]).toContain(
      'disabled=""',
    );
  });

  it('is disabled while a save is running', () => {
    expect(render(props({ busy: true }))).toMatch(
      /<button[^>]*disabled=""[^>]*>Rotate key<\/button>/,
    );
  });

  it('sends the version it last read and returns the new form', async () => {
    const next = detail({ publicKey: 'ZzZzZzZzZzZzZzZzZzZzZz', rowVersion: 5 });
    formAction.mockResolvedValueOnce(next);
    await expect(rotateKey(ID, 4)).resolves.toEqual({ kind: 'ok', form: next });
    expect(formAction).toHaveBeenLastCalledWith(ID, 'rotate-key', 4);
  });

  it('reports a version conflict apart from any other failure', async () => {
    formAction.mockRejectedValueOnce(new ApiError(409, 'ROW_VERSION_CONFLICT', 'stale'));
    await expect(rotateKey(ID, 4)).resolves.toEqual({ kind: 'conflict' });
    formAction.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'boom'));
    await expect(rotateKey(ID, 4)).resolves.toEqual({ kind: 'error' });
    formAction.mockRejectedValueOnce(new Error('offline'));
    await expect(rotateKey(ID, 4)).resolves.toEqual({ kind: 'error' });
  });
});
