import { describe, expect, it } from 'vitest';
import { createPath, draftParam, flowFor, senderParam } from './create-flow';

const ID = '3f2b8c1e-0000-4000-8000-000000000001';
const senders = [
  { key: `waba:${ID}`, guided: true },
  { key: 'waba:unverified-1', guided: false },
  { key: `twilio:${ID}`, guided: false },
];

describe('create flow', () => {
  it('opens the guided flow only for a verified Meta number', () => {
    expect(flowFor(senders, `waba:${ID}`)).toBe('wizard');
    expect(flowFor(senders, 'waba:unverified-1')).toBe('classic');
    expect(flowFor(senders, `twilio:${ID}`)).toBe('classic');
    expect(flowFor(senders, 'waba:unknown')).toBe('classic');
    expect(flowFor([], '')).toBe('classic');
  });

  it('builds the one address with the number or the draft', () => {
    expect(createPath()).toBe('/campaigns/create');
    expect(createPath({ sender: `waba:${ID}` })).toBe(`/campaigns/create?sender=waba%3A${ID}`);
    expect(createPath({ draft: ID, sender: 'x:y' })).toBe(`/campaigns/create?draft=${ID}`);
  });

  it('reads back only well-formed parameters', () => {
    expect(senderParam(`waba:${ID}`)).toBe(`waba:${ID}`);
    expect(senderParam([`waba:${ID}`, 'x'])).toBe(`waba:${ID}`);
    expect(senderParam('waba without colon id')).toBe('');
    expect(senderParam(undefined)).toBe('');
    expect(draftParam(ID)).toBe(ID);
    expect(draftParam('nope')).toBe('');
  });
});
