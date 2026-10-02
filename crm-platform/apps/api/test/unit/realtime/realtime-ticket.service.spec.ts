import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { REALTIME_TICKET_TTL_SECONDS } from '@crm/contracts';
import {
  RealtimeTicketService,
  type TicketClaims,
} from '../../../src/realtime/ticket/realtime-ticket.service';
import { FakeRedis } from './fake-redis';

const CLAIMS: TicketClaims = {
  sub: 7,
  org: 3,
  typ: 'user',
  uid: '11111111-1111-4111-8111-111111111111',
  sid: '22222222-2222-4222-8222-222222222222',
  ep: 0,
};

let redis: FakeRedis;
let tickets: RealtimeTicketService;

beforeEach(() => {
  redis = new FakeRedis();
  tickets = new RealtimeTicketService(redis as never);
});

describe('realtime ticket: mint', () => {
  it('returns an unguessable ticket and its lifetime', async () => {
    const a = await tickets.mint(CLAIMS);
    const b = await tickets.mint(CLAIMS);
    expect(a.ticket).toMatch(/^rtk_[A-Za-z0-9_-]{43}$/);
    expect(a.ticket).not.toBe(b.ticket);
    expect(a.expiresIn).toBe(REALTIME_TICKET_TTL_SECONDS);
  });

  it('stores the claims under the hash of the ticket, never under the ticket itself', async () => {
    const { ticket } = await tickets.mint(CLAIMS);
    const keys = redis.keys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe(`rt:ticket:${createHash('sha256').update(ticket).digest('hex')}`);
    expect(keys[0]).not.toContain(ticket);
  });
});

describe('realtime ticket: consume', () => {
  it('gives back the claims the ticket was minted with', async () => {
    const { ticket } = await tickets.mint(CLAIMS);
    expect(await tickets.consume(ticket)).toEqual(CLAIMS);
  });

  it('works once: the second use of the same ticket is refused (replay)', async () => {
    const { ticket } = await tickets.mint(CLAIMS);
    expect(await tickets.consume(ticket)).not.toBeNull();
    expect(await tickets.consume(ticket)).toBeNull();
  });

  it('two handshakes racing for one ticket: exactly one wins', async () => {
    const { ticket } = await tickets.mint(CLAIMS);
    const results = await Promise.all([tickets.consume(ticket), tickets.consume(ticket)]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it('expires after its lifetime', async () => {
    const { ticket } = await tickets.mint(CLAIMS);
    redis.advance((REALTIME_TICKET_TTL_SECONDS - 1) * 1000);
    expect(await tickets.consume(ticket)).not.toBeNull();

    const late = await tickets.mint(CLAIMS);
    redis.advance((REALTIME_TICKET_TTL_SECONDS + 1) * 1000);
    expect(await tickets.consume(late.ticket)).toBeNull();
  });

  it('refuses a forged, truncated, empty or non-string ticket without touching Redis', async () => {
    await tickets.mint(CLAIMS);
    for (const bad of [
      '',
      'rtk_',
      'rtk_short',
      'not-a-ticket',
      `rtk_${'A'.repeat(44)}`,
      null,
      undefined,
      42,
      {},
    ]) {
      expect(await tickets.consume(bad)).toBeNull();
    }
    // The one real ticket is still there: nothing above consumed it.
    expect(redis.keys()).toHaveLength(1);
  });

  it('one ticket opens one identity: a ticket minted for another user does not give this one', async () => {
    const mine = await tickets.mint(CLAIMS);
    const theirs = await tickets.mint({ ...CLAIMS, sub: 99 });
    expect((await tickets.consume(mine.ticket))?.sub).toBe(7);
    expect((await tickets.consume(theirs.ticket))?.sub).toBe(99);
  });
});
