import type { InboxTemplateOption } from '@crm/contracts';
import {
  clearTemplateDraft,
  getTemplateDraft,
  setTemplateValue,
  startTemplateDraft,
} from './template-draft';
import {
  allSlotsFilled,
  categoryWord,
  fillTokens,
  renderTemplate,
  valueProblem,
  valuesKey,
} from './template-model';

const template = (over: Partial<InboxTemplateOption> = {}): InboxTemplateOption => ({
  id: '22222222-2222-4222-8222-222222222222',
  name: 'otp',
  language: 'en',
  category: 'AUTHENTICATION',
  header: 'Hello',
  body: 'Hi {{1}}, your code is {{2}}.',
  footer: 'Expires soon',
  buttons: [],
  slots: [
    { key: '1', label: 'first name', example: 'Asha' },
    { key: '2', label: 'code', example: null },
  ],
  sendable: true,
  reason: null,
  ...over,
});

describe('fillTokens', () => {
  it('puts what was typed in place of each {{key}}', () => {
    expect(fillTokens('Hi {{1}}, code {{2}}', { '1': 'Asha', '2': '4821' })).toBe(
      'Hi Asha, code 4821',
    );
  });
  it('keeps the token for a slot with nothing typed, so the preview shows what is missing', () => {
    expect(fillTokens('Hi {{1}}, code {{2}}', { '1': 'Asha', '2': '   ' })).toBe(
      'Hi Asha, code {{2}}',
    );
    expect(fillTokens('Hi {{1}}', {})).toBe('Hi {{1}}');
  });
  it('trims the typed value and tolerates spaces inside the braces', () => {
    expect(fillTokens('Hi {{ 1 }}', { '1': '  Asha ' })).toBe('Hi Asha');
  });
  it('does not treat typed text as a token (no second pass)', () => {
    expect(fillTokens('A {{1}} B {{2}}', { '1': '{{2}}', '2': 'x' })).toBe('A {{2}} B x');
  });
});

describe('renderTemplate / allSlotsFilled / valuesKey / categoryWord', () => {
  it('leaves out the blank lines a body was written with, so the bubble has no gap', () => {
    expect(
      renderTemplate(template({ header: '  ', body: '\nHi {{1}}\n', footer: '' }), { '1': 'Asha' }),
    ).toEqual({ header: null, body: 'Hi Asha', footer: null });
  });
  it('fills the body and leaves the header and footer as written', () => {
    expect(renderTemplate(template(), { '1': 'Asha', '2': '1' })).toEqual({
      header: 'Hello',
      body: 'Hi Asha, your code is 1.',
      footer: 'Expires soon',
    });
  });
  it('is ready only when every slot has something typed', () => {
    expect(allSlotsFilled(template(), { '1': 'a' })).toBe(false);
    expect(allSlotsFilled(template(), { '1': 'a', '2': '  ' })).toBe(false);
    expect(allSlotsFilled(template(), { '1': 'a', '2': 'b' })).toBe(true);
    expect(allSlotsFilled(template({ slots: [] }), {})).toBe(true);
  });
  it('tells two attempts apart by what is typed, ignoring spaces around it', () => {
    expect(valuesKey(template(), { '1': 'a ', '2': 'b' })).toBe(
      valuesKey(template(), { '1': 'a', '2': ' b' }),
    );
    expect(valuesKey(template(), { '1': 'a', '2': 'b' })).not.toBe(
      valuesKey(template(), { '1': 'a', '2': 'c' }),
    );
  });
  it('writes the category in lower case', () => {
    expect(categoryWord('MARKETING')).toBe('marketing');
  });
});

describe('template draft', () => {
  afterEach(() => clearTemplateDraft());
  it('starts empty, keeps what is typed, drops it on a new template and on clear', () => {
    expect(getTemplateDraft()).toBeNull();
    startTemplateDraft('c1', template());
    setTemplateValue('1', 'Asha');
    expect(getTemplateDraft()?.values).toEqual({ '1': 'Asha' });
    startTemplateDraft('c1', template({ id: '33333333-3333-4333-8333-333333333333' }));
    expect(getTemplateDraft()?.values).toEqual({});
    clearTemplateDraft();
    expect(getTemplateDraft()).toBeNull();
  });
  it('ignores a typed value when there is no draft', () => {
    setTemplateValue('1', 'x');
    expect(getTemplateDraft()).toBeNull();
  });
});

describe('values WhatsApp would refuse', () => {
  it('flags a new line, a tab, or four or more spaces in a row, and nothing else', () => {
    expect(valueProblem('Asha')).toBeNull();
    expect(valueProblem('Asha K  Mehta')).toBeNull();
    expect(valueProblem('')).toBeNull();
    expect(valueProblem('a\nb')).toBe('format');
    expect(valueProblem('a\tb')).toBe('format');
    expect(valueProblem('a    b')).toBe('format');
  });
  it('is not ready while a typed value is one WhatsApp refuses', () => {
    expect(allSlotsFilled(template(), { '1': 'Asha', '2': 'a    b' })).toBe(false);
  });
  it('does not take a token named like an object member from the prototype', () => {
    expect(fillTokens('x {{constructor}} y', {})).toBe('x {{constructor}} y');
    expect(fillTokens('x {{__proto__}} y', {})).toBe('x {{__proto__}} y');
    expect(
      allSlotsFilled(template({ slots: [{ key: 'constructor', label: 'c', example: null }] }), {}),
    ).toBe(false);
  });
});
