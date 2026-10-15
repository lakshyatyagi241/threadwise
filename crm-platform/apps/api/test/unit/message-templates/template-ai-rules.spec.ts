import { describe, expect, it } from 'vitest';
import {
  parseTemplateDraft,
  templateBriefLines,
  templateSlug,
} from '../../../src/modules/message-templates/template-ai-rules';

const draft = (o: object) => JSON.stringify(o);

describe('the template name', () => {
  it('becomes a slug Meta takes', () => {
    expect(templateSlug('Order Update – Spring!')).toBe('order_update_spring');
    expect(templateSlug('  __x__ ')).toBe('x');
    expect(templateSlug('')).toBe('ai_template');
    expect(templateSlug(42)).toBe('ai_template');
    expect(templateSlug('a'.repeat(100))).toHaveLength(60);
  });
});

describe("the model's answer", () => {
  it('is null unless it is a JSON object, with a code fence tolerated', () => {
    expect(parseTemplateDraft('hello')).toBeNull();
    expect(parseTemplateDraft('[1]')).toBeNull();
    expect(parseTemplateDraft('```json\n{"template_name":"a","body":"b"}\n```')).toMatchObject({
      name: 'a',
      body: 'b',
    });
  });

  it('is cut to the limits and loses variables in the header and footer', () => {
    const d = parseTemplateDraft(
      draft({
        template_name: 'x',
        header: `Hello {{1}} ${'h'.repeat(100)}`,
        body: 'b'.repeat(2000),
        footer: 'Bye {{2}}',
      }),
    )!;
    expect(d.header?.length).toBeLessThanOrEqual(60);
    expect(d.header).not.toContain('{{');
    expect(d.body).toHaveLength(1024);
    expect(d.footer).toBe('Bye');
  });

  it('keeps at most three valid buttons: a link needs http(s), a call a phone, a quick reply never sits with a link', () => {
    const d = parseTemplateDraft(
      draft({
        body: 'b',
        buttons: [
          { type: 'visit_website', text: 'Site', value: 'https://a.test' },
          { type: 'visit_website', text: 'Bad', value: 'ftp://a.test' },
          { type: 'call_phone', text: 'Call', value: '+91 (98) 765-4321' },
          { type: 'call_phone', text: 'No number', value: 'abc' },
          { type: 'quick_reply', text: 'Ok', value: '' },
          { type: 'copy_code', text: 'Code', value: 'X1' },
        ],
      }),
    )!;
    expect(d.buttons).toEqual([
      { type: 'URL', text: 'Site', url: 'https://a.test' },
      { type: 'PHONE_NUMBER', text: 'Call', phoneNumber: '+91987654321' },
    ]);
  });

  it('keeps quick replies when there is no link button, and drops buttons without a label', () => {
    const d = parseTemplateDraft(
      draft({
        body: 'b',
        buttons: [
          { type: 'quick_reply', text: 'Yes' },
          { type: 'quick_reply', text: '' },
          { type: 'quick_reply', text: 'No' },
        ],
      }),
    )!;
    expect(d.buttons).toEqual([
      { type: 'QUICK_REPLY', text: 'Yes' },
      { type: 'QUICK_REPLY', text: 'No' },
    ]);
  });
});

describe('the brief', () => {
  it('has a line for each field filled in', () => {
    const lines = templateBriefLines({
      provider: 'openai',
      model: 'm',
      metaCategory: 'UTILITY',
      language: 'hi_IN',
      businessName: 'B',
      purpose: 'Order update',
      customPrompt: 'Short please',
    });
    expect(lines).toEqual([
      'Business name: B',
      'Template category (Meta review path): utility',
      'Language: hi_IN',
      'Message purpose: Order update',
      '',
      'Additional operator notes:',
      'Short please',
    ]);
  });
});
