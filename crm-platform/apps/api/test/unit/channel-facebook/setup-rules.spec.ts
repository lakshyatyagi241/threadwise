import { describe, expect, it } from 'vitest';
import {
  GREETING_LIMIT,
  buildIceBreakers,
  buildMenu,
  greetingText,
  greetingUnsupported,
  readProfile,
  rejectedMessage,
} from '../../../src/modules/channel-facebook/setup-rules';

describe('reading the Messenger profile (TW-FB-015)', () => {
  it('an empty profile is empty everywhere', () => {
    expect(readProfile({})).toEqual({
      getStarted: '',
      greeting: '',
      menuItems: [],
      composerDisabled: false,
      iceBreakers: [],
    });
  });

  it('reads Get Started, the default-locale greeting, the default menu block and localized ice breakers', () => {
    const v = readProfile({
      get_started: { payload: 'GET_STARTED' },
      greeting: [
        { locale: 'fr_FR', text: 'Bonjour' },
        { locale: 'default', text: 'Hello' },
      ],
      persistent_menu: [
        { locale: 'fr_FR', call_to_actions: [{ type: 'postback', title: 'Salut', payload: 'S' }] },
        {
          locale: 'default',
          composer_input_disabled: true,
          call_to_actions: [
            { type: 'web_url', title: 'Shop', url: 'https://x.test' },
            { type: 'postback', title: 'Talk', payload: 'TALK' },
            { type: 'nested', title: 'Odd' },
          ],
        },
      ],
      ice_breakers: [
        { locale: 'default', call_to_actions: [{ question: 'Hours?', payload: 'HOURS' }] },
      ],
    });
    expect(v.getStarted).toBe('GET_STARTED');
    expect(v.greeting).toBe('Hello');
    expect(v.composerDisabled).toBe(true);
    expect(v.menuItems).toEqual([
      { title: 'Shop', type: 'web_url', url: 'https://x.test', payload: '' },
      { title: 'Talk', type: 'postback', url: '', payload: 'TALK' },
      { title: 'Odd', type: 'postback', url: '', payload: '' },
    ]);
    expect(v.iceBreakers).toEqual([{ question: 'Hours?', payload: 'HOURS' }]);
  });

  it('without a default locale the last greeting and the first menu block are used', () => {
    const v = readProfile({
      greeting: [
        { locale: 'fr_FR', text: 'Bonjour' },
        { locale: 'de_DE', text: 'Hallo' },
      ],
      persistent_menu: [
        { locale: 'fr_FR', call_to_actions: [{ type: 'postback', title: 'Salut' }] },
      ],
    });
    expect(v.greeting).toBe('Hallo');
    expect(v.menuItems.map((m) => m.title)).toEqual(['Salut']);
  });

  it('ice breakers also come as one block without a locale, or as the older flat list', () => {
    expect(
      readProfile({ ice_breakers: [{ call_to_actions: [{ question: 'A?', payload: 'a' }] }] })
        .iceBreakers,
    ).toEqual([{ question: 'A?', payload: 'a' }]);
    expect(
      readProfile({ ice_breakers: [{ question: 'Flat?', payload: 'f' }, 'junk', null] })
        .iceBreakers,
    ).toEqual([{ question: 'Flat?', payload: 'f' }]);
  });
});

describe('building what Meta accepts (TW-FB-015)', () => {
  it('the greeting is trimmed and cut at 160 characters', () => {
    expect(greetingText('  Hi  ')).toBe('Hi');
    expect(greetingText('x'.repeat(200))).toHaveLength(GREETING_LIMIT);
    expect(greetingText('é'.repeat(200))).toHaveLength(GREETING_LIMIT);
  });

  it('menu rows without a title or a link without an address are skipped; a tap with no payload is named by its place in the posted rows', () => {
    const out = buildMenu([
      { title: '', type: 'postback', url: '', payload: '' },
      { title: 'Shop', type: 'web_url', url: '', payload: '' },
      { title: 'Talk to us', type: 'postback', url: '', payload: '' },
      { title: 'Site', type: 'web_url', url: ' https://x.test ', payload: '' },
      { title: 'Help', type: 'postback', url: '', payload: 'HELP' },
    ]);
    expect(out).toEqual([
      { type: 'postback', title: 'Talk to us', payload: 'MENU_3' },
      { type: 'web_url', title: 'Site', url: 'https://x.test', webview_height_ratio: 'full' },
      { type: 'postback', title: 'Help', payload: 'HELP' },
    ]);
  });

  it('a menu keeps three items at most and cuts titles to 30; an unknown type is a tap', () => {
    const rows = ['a', 'b', 'c', 'd'].map((t) => ({
      title: t.repeat(40),
      type: 'whatever',
      url: '',
      payload: 'P',
    }));
    const out = buildMenu(rows);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ type: 'postback', title: 'a'.repeat(30) });
    expect(buildMenu([])).toEqual([]);
  });

  it('ice breakers keep four at most, cut questions to 80 and name a blank payload by its place', () => {
    const out = buildIceBreakers([
      { question: '', payload: 'x' },
      { question: 'What are your hours?', payload: '' },
      { question: 'q'.repeat(100), payload: ' P ' },
      { question: 'c', payload: '' },
      { question: 'd', payload: '' },
      { question: 'e', payload: '' },
    ]);
    expect(out).toEqual([
      { question: 'What are your hours?', payload: 'ICE_BREAKER_2' },
      { question: 'q'.repeat(80), payload: 'P' },
      { question: 'c', payload: 'ICE_BREAKER_4' },
      { question: 'd', payload: 'ICE_BREAKER_5' },
    ]);
  });
});

describe('a greeting Meta no longer takes (TW-FB-015 rule 2)', () => {
  const dropped =
    '(#100) Requires one of the params: get_started,persistent_menu,whitelisted_domains,account_linking_url,home_url,ice_breakers,platform,description,commands';

  it('is recognised by the list of accepted params that leaves greeting out', () => {
    expect(greetingUnsupported(dropped)).toBe(true);
  });

  it('is never confused with a real failure', () => {
    expect(greetingUnsupported('')).toBe(false);
    expect(greetingUnsupported('Error validating access token')).toBe(false);
    expect(greetingUnsupported('(#200) Requires pages_messaging permission')).toBe(false);
    expect(greetingUnsupported(dropped.replace('get_started', 'greeting,get_started'))).toBe(false);
  });

  it('a refusal carries Meta’s reason', () => {
    expect(rejectedMessage('Invalid payload')).toBe(
      'Facebook rejected the change: Invalid payload',
    );
    expect(rejectedMessage(undefined)).toBe('Facebook rejected the change: unknown error');
  });
});
