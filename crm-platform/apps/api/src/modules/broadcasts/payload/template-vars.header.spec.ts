import { describe, expect, it } from 'vitest';
import { buildRecipientVars } from './template-vars';

const shape = (over: Record<string, unknown>) =>
  ({
    templateName: 't',
    language: 'en',
    templateType: 'standard',
    templateBody: 'Hi',
    header: null,
    attachmentType: 'image',
    attachmentFile: 'meta-handle-4::abc',
    parameterFormat: null,
    variableMap: {},
    buttons: [],
    carouselData: null,
    headerLocation: null,
    headerMediaKey: null,
    ...over,
  }) as never;

const ctx = (links: Record<string, string>) => ({
  pull: () => '',
  mediaUrl: (p: string) => links[p] ?? (/^https?:\/\//i.test(p) ? p : null),
});

describe('buildRecipientVars header media (row 426)', () => {
  it("links the stored file by its key, never Meta's handle in attachment_file", () => {
    const vars = buildRecipientVars(
      shape({ headerMediaKey: 'templates/1/h.png' }),
      ctx({ 'templates/1/h.png': 'https://cdn.example.com/h.png' }),
    );
    expect(vars.headerMediaUrl).toBe('https://cdn.example.com/h.png');
  });

  it('falls back to an https attachment_file when the key has no link', () => {
    const vars = buildRecipientVars(
      shape({ headerMediaKey: 'templates/1/h.png', attachmentFile: 'https://x.test/a.png' }),
      ctx({}),
    );
    expect(vars.headerMediaUrl).toBe('https://x.test/a.png');
  });

  it('sets no header link when neither the key nor the handle can be linked', () => {
    expect(
      buildRecipientVars(shape({ headerMediaKey: 'k.png' }), ctx({})).headerMediaUrl,
    ).toBeUndefined();
  });
});
