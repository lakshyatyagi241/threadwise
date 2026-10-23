import { describe, expect, it } from 'vitest';
import {
  bodyPattern,
  matchTemplateByBody,
  type MatchCandidate,
} from '../../../src/modules/team-inbox-conversations/inbox-template-rules';

const links = [
  { type: 'url' as const, text: 'Sponsor Online', url: 'https://example.org/annadanam' },
];
const phone = [{ type: 'phone' as const, text: 'Call us', phone: '+6582994062' }];

const lastChance: MatchCandidate = {
  name: 'pitr_paksa_last_chance',
  header: null,
  body: '🎉 *LAST CHANCE: Pitṛ Pakṣa Ends Oct 10!* 🎉\n\nOffer pure sāttvic Annadānam for your ancestors through {{1}}.\n\nFulfil your sacred duty before time runs out!',
  buttons: links,
};
const other: MatchCandidate = {
  name: 'welcome_evening',
  header: null,
  body: 'Welcome to a blissful evening with {{1}}\n\nPlease Donate Generously and be blessed',
  buttons: phone,
};

describe('matching a message the business sent to a template by its body', () => {
  it('finds the template when the words are the same, whatever the formatting marks, spacing and case', () => {
    const sent =
      '🎉 LAST CHANCE: Pitṛ Pakṣa Ends Oct 10! 🎉\n\n  Offer pure sāttvic  Annadānam for your ancestors through ISKM Singapore.\nFulfil your sacred duty before time runs out!';
    // the paragraph break is a space once compared; the line break before "Fulfil" too
    expect(matchTemplateByBody(sent, [other, lastChance])?.name).toBe('pitr_paksa_last_chance');
  });

  it('lets a {{variable}} stand for any text, including several words', () => {
    const sent =
      '🎉 *LAST CHANCE: Pitṛ Pakṣa Ends Oct 10!* 🎉 Offer pure sāttvic Annadānam for your ancestors through the Sri Krishna Mandir team. Fulfil your sacred duty before time runs out!';
    expect(matchTemplateByBody(sent, [lastChance])?.name).toBe('pitr_paksa_last_chance');
  });

  it('gives nothing for a message that only resembles a template (a wrong button is worse than a missing one)', () => {
    const near =
      '🎉 LAST CHANCE: Pitṛ Pakṣa Ends Oct 12! 🎉 Offer pure sāttvic Annadānam for your ancestors through ISKM. Fulfil your sacred duty before time runs out!';
    expect(matchTemplateByBody(near, [lastChance])).toBeNull();
    expect(matchTemplateByBody('Hello', [lastChance, other])).toBeNull();
    expect(matchTemplateByBody(null, [lastChance])).toBeNull();
    expect(matchTemplateByBody('   ', [lastChance])).toBeNull();
  });

  it('gives nothing when two templates read the same (it cannot tell which was sent)', () => {
    const twin = { ...lastChance, name: 'twin', buttons: phone };
    expect(
      matchTemplateByBody(lastChance.body.replace('{{1}}', 'X'), [lastChance, twin]),
    ).toBeNull();
  });

  it('ignores a template with no buttons, and a body with too little fixed text to be distinctive', () => {
    expect(
      matchTemplateByBody('Thanks {{x}}'.replace('{{x}}', 'Ann'), [
        { ...lastChance, body: 'Thanks {{1}}' },
      ]),
    ).toBeNull();
    expect(bodyPattern('Hi {{1}}')).toBeNull();
    expect(
      matchTemplateByBody(lastChance.body.replace('{{1}}', 'X'), [{ ...lastChance, buttons: [] }]),
    ).toBeNull();
  });

  it('reads a text header followed by the body', () => {
    const withHeader: MatchCandidate = {
      ...other,
      name: 'hdr',
      header: 'Evening offer for everyone',
    };
    const sent =
      'Evening offer for everyone\nWelcome to a blissful evening with Lord Jagannatha\n\nPlease Donate Generously and be blessed';
    expect(matchTemplateByBody(sent, [withHeader])?.name).toBe('hdr');
  });

  it('stays fast on a long message against a body with many variables (no backtracking)', () => {
    const body = Array.from(
      { length: 12 },
      (_, i) => `part number ${i} of the offer {{${i + 1}}}`,
    ).join(' and ');
    const long = 'part number 0 of the offer '.repeat(150) + 'tail that never matches';
    const started = Date.now();
    expect(matchTemplateByBody(long, [{ ...other, body }])).toBeNull();
    expect(Date.now() - started).toBeLessThan(200);
  });
});
