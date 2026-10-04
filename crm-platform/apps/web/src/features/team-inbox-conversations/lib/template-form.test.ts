import { describe, expect, it } from 'vitest';
import { previewBody, sendableValues, slotProblems } from './template-form';

const slots = [
  { key: '1', label: 'first name', example: 'Ana' },
  { key: '2', label: 'Variable 2', example: null },
];
const template = { slots };

describe('previewBody', () => {
  it('fills what has been typed and leaves the rest as the customer would not see it yet', () => {
    expect(previewBody('Hi {{1}}, order {{2}}.', { '1': 'Ana' })).toBe('Hi Ana, order {{2}}.');
    expect(previewBody('Hi {{1}}, order {{2}}.', { '1': ' Ana ', '2': 'A12' })).toBe(
      'Hi Ana, order A12.',
    );
    expect(previewBody('No variables', {})).toBe('No variables');
  });

  it('treats a blank value as missing', () => {
    expect(previewBody('Hi {{1}}', { '1': '   ' })).toBe('Hi {{1}}');
  });
});

describe('slotProblems', () => {
  it('flags an empty slot as required', () => {
    expect(slotProblems(template, { '1': 'Ana' })).toEqual({ '2': 'required' });
    expect(slotProblems(template, {})).toEqual({ '1': 'required', '2': 'required' });
  });

  it('flags what WhatsApp would refuse', () => {
    expect(slotProblems(template, { '1': 'a\nb', '2': 'x' })).toEqual({ '1': 'format' });
    expect(slotProblems(template, { '1': 'a\tb', '2': 'x' })).toEqual({ '1': 'format' });
    expect(slotProblems(template, { '1': 'a    b', '2': 'x' })).toEqual({ '1': 'format' });
  });

  it('has no problems when everything is filled', () => {
    expect(slotProblems(template, { '1': 'Ana', '2': 'A12' })).toEqual({});
    expect(slotProblems({ slots: [] }, {})).toEqual({});
  });
});

describe('sendableValues', () => {
  it('carries only the template’s slots, trimmed', () => {
    expect(sendableValues(template, { '1': ' Ana ', '2': 'A12', '9': 'stray' })).toEqual({
      '1': 'Ana',
      '2': 'A12',
    });
  });
});
