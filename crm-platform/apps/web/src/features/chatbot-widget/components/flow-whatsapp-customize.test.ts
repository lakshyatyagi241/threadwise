import { describe, expect, it } from 'vitest';
import { WIDGET_BUILDER_DEFAULTS } from '@crm/contracts';
import {
  botTarget,
  messageMissesKeyword,
  splitNumber,
  whatsappStart,
} from './flow-whatsapp-customize';

const bot = (over: Partial<Parameters<typeof whatsappStart>[1]> = {}) => ({
  phone: '919876543210',
  numberLabel: 'Support line',
  keyword: 'hello',
  ...over,
});

describe("a WhatsApp bot's button is made from the bot", () => {
  it("aims at the bot's own number, split into dial code and digits, and prefills its keyword", () => {
    expect(whatsappStart('Support bot', bot())).toMatchObject({
      mode: 'whatsapp',
      name: 'Support bot',
      targetWhatsappCc: '+91',
      targetWhatsappNumber: '9876543210',
      prefilledMessage: 'hello',
    });
  });

  it('accepts a number written with a plus and spaces', () => {
    const s = whatsappStart('Bot', bot({ phone: '+44 7911 123456', keyword: '' }));
    expect(s).toMatchObject({ targetWhatsappCc: '+44', targetWhatsappNumber: '7911123456' });
  });

  it('keeps the default message when the bot starts on any message', () => {
    expect(whatsappStart('Bot', bot({ keyword: '' })).prefilledMessage).toBe(
      WIDGET_BUILDER_DEFAULTS.prefilledMessage,
    );
  });

  it('leaves the number blank when the bot has none, so nothing can be saved or linked to', () => {
    const s = whatsappStart('Bot', bot({ phone: null }));
    expect(s.targetWhatsappCc).toBe('');
    expect(s.targetWhatsappNumber).toBe('');
  });

  it('follows the bot again after the Trigger changes: the number and keyword are re-read, the look is kept', () => {
    const first = whatsappStart('Bot', bot());
    const styled = { ...first, headerTitle: 'My look' };
    const next = botTarget(styled, bot({ phone: '+44 7911 123456', keyword: 'join' }));
    expect(next).toMatchObject({
      headerTitle: 'My look',
      targetWhatsappCc: '+44',
      targetWhatsappNumber: '7911123456',
      prefilledMessage: 'join',
    });
  });
});

describe('a button that already exists keeps its own message', () => {
  const saved = {
    ...whatsappStart('Bot', bot()),
    prefilledMessage: 'Hi, I would like to know more about your products and services.',
  };

  it('does not replace a saved or migrated message with the keyword', () => {
    expect(botTarget(saved, bot(), true).prefilledMessage).toBe(saved.prefilledMessage);
  });

  it('still fills an empty message from the keyword, and a new bot always starts from it', () => {
    expect(botTarget({ ...saved, prefilledMessage: '  ' }, bot(), true).prefilledMessage).toBe(
      'hello',
    );
    expect(botTarget(saved, bot()).prefilledMessage).toBe('hello');
  });

  it('warns when a tap would not send the start word', () => {
    expect(messageMissesKeyword(saved.prefilledMessage, 'hello')).toBe(true);
    expect(messageMissesKeyword('Hello there', 'hello')).toBe(false);
    expect(messageMissesKeyword('anything', '')).toBe(false);
  });
});

describe('a connected number as the button needs it', () => {
  it('splits into dial code and national digits, with or without a plus', () => {
    expect(splitNumber('919876543210')).toEqual({ cc: '+91', number: '9876543210' });
    expect(splitNumber('+44 7911 123456')).toEqual({ cc: '+44', number: '7911123456' });
    expect(splitNumber('+1 555-013-7150')).toEqual({ cc: '+1', number: '5550137150' });
  });

  it('is null for a number with no digits or one that does not parse', () => {
    expect(splitNumber(null)).toBeNull();
    expect(splitNumber('')).toBeNull();
    expect(splitNumber('12')).toBeNull();
  });
});
