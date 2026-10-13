import { describe, expect, it } from 'vitest';
import {
  CONSENT_SETTINGS_DEFAULTS,
  appendOptOutLine,
  compileConsentKeywords,
  evaluateConsentMessage,
  fillConsentReply,
  hasOptOutInstruction,
  matchConsentKeyword,
  normaliseConsentText,
} from '@crm/contracts';

const compiled = compileConsentKeywords({
  optOut: CONSENT_SETTINGS_DEFAULTS.optOutKeywords,
  optIn: CONSENT_SETTINGS_DEFAULTS.optInKeywords,
});
const hit = (t: string) => matchConsentKeyword(t, compiled)?.action ?? null;

describe('normaliseConsentText', () => {
  it.each([
    ['  STOP ', 'stop'],
    ['Stop.', 'stop'],
    ['STOP!!', 'stop'],
    ['\u{1F6D1} stop', 'stop'],
    ['opt-out', 'opt out'],
    ['​stop‏', 'stop'],
    ['ＳＴＯＰ', 'stop'],
    ['إيقاف', 'ايقاف'],
    ['إيقافً', 'ايقاف'],
    ['  opt   out  ', 'opt out'],
  ])('%j -> %j', (input, expected) => {
    expect(normaliseConsentText(input)).toBe(expected);
  });
});

describe('matching table (whole message rule)', () => {
  it.each([
    ['STOP', 'opt_out'],
    ['stop', 'opt_out'],
    [' Stop. ', 'opt_out'],
    ['STOP!!', 'opt_out'],
    ['\u{1F6D1} stop', 'opt_out'],
    ['stopall', 'opt_out'],
    ['Unsubscribe', 'opt_out'],
    ['opt-out', 'opt_out'],
    ['OPT OUT', 'opt_out'],
    ['إيقاف', 'opt_out'],
    ['ايقاف', 'opt_out'],
    ['توقف', 'opt_out'],
    ['الغاء الاشتراك', 'opt_out'],
    ['إلغاء الاشتراك', 'opt_out'],
    ['START', 'opt_in'],
    ['unstop', 'opt_in'],
    ['Subscribe', 'opt_in'],
    ['اشتراك', 'opt_in'],
    ['ابدأ', 'opt_in'],
  ])('%j is %s', (text, action) => {
    expect(hit(text)).toBe(action);
  });

  it.each([
    "don't stop",
    'stop sending me invoices please',
    'please stop',
    'stop stop',
    '> stop',
    'I want to start a new order',
    '',
    '   ',
    '???',
    'stop '.repeat(40),
    'x'.repeat(500),
  ])('%j is not a keyword', (text) => {
    expect(hit(text)).toBeNull();
  });

  it('opt-out wins when a word is in both lists', () => {
    const c = compileConsentKeywords({ optOut: { en: ['end'] }, optIn: { en: ['END'] } });
    expect(matchConsentKeyword('end', c)?.action).toBe('opt_out');
  });

  it('reports the language of the matching list, English first on a shared word', () => {
    expect(matchConsentKeyword('توقف', compiled)?.lang).toBe('ar');
    expect(matchConsentKeyword('stop', compiled)?.lang).toBe('en');
    const shared = compileConsentKeywords({ optOut: { fr: ['stop'], en: ['stop'] }, optIn: {} });
    expect(matchConsentKeyword('stop', shared)?.lang).toBe('en');
  });

  it('keeps the matched keyword, never the customer text', () => {
    expect(matchConsentKeyword('  STOP!! ', compiled)?.keyword).toBe('stop');
  });
});

describe('evaluateConsentMessage (the test box)', () => {
  const s = CONSENT_SETTINGS_DEFAULTS;
  it('opts out and answers in the keyword language', () => {
    const r = evaluateConsentMessage('توقف', s);
    expect(r).toMatchObject({ match: 'opt_out', lang: 'ar', outcome: 'opts_out' });
    expect(r.reply).toContain('اشتراك');
  });
  it('opt-in reply tells how to stop again', () => {
    expect(evaluateConsentMessage('START', s).reply).toMatch(/STOP/);
  });
  it('no reply when auto reply is off, and nothing when detection is off', () => {
    expect(evaluateConsentMessage('stop', { ...s, autoReplyEnabled: false }).reply).toBeNull();
    expect(evaluateConsentMessage('stop', { ...s, detectionEnabled: false }).outcome).toBe(
      'detection_off',
    );
  });
  it('a long sentence containing stop does nothing', () => {
    expect(evaluateConsentMessage('please stop sending me this', s).outcome).toBe('no_match');
  });
});

describe('fillConsentReply', () => {
  it('fills the first name and leaves no hole', () => {
    expect(fillConsentReply('Bye {{name}}, done.', { name: 'Sara Ali' })).toBe('Bye Sara, done.');
    expect(fillConsentReply('Bye {{name}}, done.', { name: null })).toBe('Bye, done.');
  });
});

describe('opt-out line', () => {
  const line = 'Reply STOP to unsubscribe';
  it('is appended once, under the text', () => {
    const once = appendOptOutLine('Big sale today', line);
    expect(once).toBe(`Big sale today\n\n${line}`);
    expect(appendOptOutLine(once, line)).toBe(once);
  });
  it('is not added when the text already says how to opt out', () => {
    expect(hasOptOutInstruction('Sale! Reply stop to opt out')).toBe(true);
    expect(appendOptOutLine('Sale! reply STOP to quit', line)).toBe('Sale! reply STOP to quit');
    expect(hasOptOutInstruction('Big sale today')).toBe(false);
  });
  it('an empty line adds nothing', () => {
    expect(appendOptOutLine('hi', '  ')).toBe('hi');
  });
});
