import { describe, expect, it } from 'vitest';
import { widgetLauncherSchema } from '@crm/contracts';
import { chatWindowLocale } from '../../../src/modules/chatbot-widget/chat-window-locale';

describe('the chat window language', () => {
  it('keeps following the visitor when no primary language is set (every widget before the setting)', () => {
    const l = widgetLauncherSchema.parse({}).chat.languages;
    expect(l).toEqual({ primary: '', additional: [] });
    expect(chatWindowLocale(l, 'pt')).toBe('pt');
    expect(chatWindowLocale(l, undefined)).toBeUndefined();
  });

  it('speaks the primary language and gives way only to a listed one', () => {
    const l = { primary: 'en', additional: ['pt'] };
    expect(chatWindowLocale(l, 'de')).toBe('en');
    expect(chatWindowLocale(l, 'pt-BR')).toBe('pt');
    expect(chatWindowLocale({ primary: 'en', additional: [] }, 'pt')).toBe('en');
  });

  it('keeps the feedback message while feedback is off', () => {
    const f = widgetLauncherSchema.parse({
      chat: { feedback: { enabled: false, message: 'Thanks!' } },
    }).chat.feedback;
    expect(f).toEqual({ enabled: false, message: 'Thanks!' });
  });
});
