import { describe, expect, it } from 'vitest';
import {
  SALESDOC_NOTIFY_EVENTS,
  copyFor,
  dedupeKeyFor,
  linkFor,
  recipientsFor,
  type SalesDocEventFacts,
} from '../../../src/modules/notifications/salesdoc-notification-rules';

const facts = (over: Partial<SalesDocEventFacts> = {}): SalesDocEventFacts => ({
  eventType: 'salesdoc.accepted',
  docUuid: '11111111-1111-4111-8111-111111111111',
  kind: 'estimate',
  number: 'EST-0007',
  by: 'buyer',
  ownerUuid: 'owner',
  createdByUuid: 'creator',
  ...over,
});

describe('quote decision notifications (WD-PROP-017)', () => {
  it('listens to the two decisions only', () => {
    expect([...SALESDOC_NOTIFY_EVENTS]).toEqual(['salesdoc.accepted', 'salesdoc.declined']);
  });

  it('tells the owner and the creator, once each', () => {
    expect(recipientsFor(facts())).toEqual(['owner', 'creator']);
    expect(recipientsFor(facts({ createdByUuid: 'owner' }))).toEqual(['owner']);
    expect(recipientsFor(facts({ ownerUuid: null }))).toEqual(['creator']);
    expect(recipientsFor(facts({ ownerUuid: null, createdByUuid: null }))).toEqual([]);
  });

  it('tells nobody when staff recorded the decision (they were there; WaDesk did not notify either)', () => {
    expect(recipientsFor(facts({ by: 'staff' }))).toEqual([]);
    expect(recipientsFor(facts({ by: null }))).toEqual([]);
  });

  it('words an accepted and a declined document, with the kind and the number', () => {
    expect(copyFor(facts(), 'Kitchen fit-out')).toEqual({
      title: 'Estimate accepted',
      body: 'EST-0007 Kitchen fit-out: the buyer accepted it',
    });
    expect(
      copyFor(
        facts({ eventType: 'salesdoc.declined', kind: 'proposal', number: 'PRO-0002' }),
        null,
      ),
    ).toEqual({
      title: 'Proposal declined',
      body: 'PRO-0002: the buyer declined it',
    });
  });

  it('strips markup and keeps the body within 200 characters', () => {
    const copy = copyFor(facts(), `<b>Big</b> ${'x'.repeat(400)}`);
    expect(copy.body).not.toContain('<');
    expect(copy.body.length).toBeLessThanOrEqual(200);
  });

  it('links the document itself, by kind', () => {
    expect(linkFor(facts())).toBe('/estimates/11111111-1111-4111-8111-111111111111');
    expect(linkFor(facts({ kind: 'proposal' }))).toBe(
      '/proposals/11111111-1111-4111-8111-111111111111',
    );
  });

  it('keys a notification by event, so a redelivery collides and a later decision does not', () => {
    expect(dedupeKeyFor('salesdoc.accepted', '41')).toBe('salesdoc.accepted:41');
    expect(dedupeKeyFor('salesdoc.accepted', '41')).not.toBe(
      dedupeKeyFor('salesdoc.accepted', '42'),
    );
  });
});
