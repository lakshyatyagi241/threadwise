import { describe, expect, it } from 'vitest';
import {
  detectScriptLanguage,
  isLatin,
  languageDisplayName,
} from '../../../src/modules/localization-translation/language-detector';

/** TW-I18N-031 */
describe('detectScriptLanguage', () => {
  it('detects Korean and Devanagari', () => {
    expect(detectScriptLanguage('안녕하세요 도와주세요')).toBe('ko');
    expect(detectScriptLanguage('नमस्ते आप कैसे हैं')).toBe('hi');
  });

  it('returns the fallback for Latin text, or en without one', () => {
    expect(detectScriptLanguage('Hola, necesito ayuda', 'es')).toBe('es');
    expect(detectScriptLanguage('Hola, necesito ayuda')).toBe('en');
    expect(detectScriptLanguage('Hola', null)).toBe('en');
  });

  it('takes the dominant non-Latin script of a mixed text', () => {
    expect(detectScriptLanguage('hii 안녕')).toBe('ko');
  });

  it('calls kanji-only text Chinese', () => {
    expect(detectScriptLanguage('请问价格是多少')).toBe('zh');
  });

  it('returns the fallback for empty or symbol-only text', () => {
    expect(detectScriptLanguage('   ', 'fr')).toBe('fr');
    expect(detectScriptLanguage('😀 123 !!!', 'fr')).toBe('fr');
  });

  it('any kana makes the text Japanese even when kanji outnumber it (Reference said Chinese)', () => {
    expect(detectScriptLanguage('東京大学の入学試験について教えてください')).toBe('ja');
  });

  it('tells Urdu from Arabic by the letters only Urdu uses (Reference could never return ur)', () => {
    expect(detectScriptLanguage('آپ کا شکریہ ٹھیک ہے')).toBe('ur');
    expect(detectScriptLanguage('شكرا جزيلا لك')).toBe('ar');
  });

  it('tells Ukrainian from Russian by its own letters', () => {
    expect(detectScriptLanguage('Дякую, їжак')).toBe('uk');
    expect(detectScriptLanguage('Спасибо большое')).toBe('ru');
  });

  it('detects Hebrew', () => expect(detectScriptLanguage('שלום מה שלומך')).toBe('he'));
});

describe('isLatin and displayName', () => {
  it('is true for empty, Latin and accented Latin text', () => {
    expect(isLatin('')).toBe(true);
    expect(isLatin('Olá, tudo bem? 123')).toBe(true);
  });
  it('is false once another script appears', () => expect(isLatin('hello 你好')).toBe(false));
  it('names languages, falling back to the upper-cased code', () => {
    expect(languageDisplayName('ja')).toBe('Japanese');
    expect(languageDisplayName('xx')).toBe('XX');
  });
});
