import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import {
  EnrichmentError,
  type EnrichmentLookup,
  type GrowthEnrichmentPort,
} from '../../../src/infra/providers/growth-enrichment/growth-enrichment.port';
import {
  enrichmentUsageId,
  isBillableLookup,
} from '../../../src/modules/growth-pilot/growth-enrichment-billing';
import { GrowthService } from '../../../src/modules/growth-pilot/growth.service';

type Lookup = EnrichmentLookup | Error;

interface Setup {
  /** The contacts the run will ask about (ids). */
  contacts?: number[];
  /** What the provider says for each contact, in order. */
  answers?: Lookup[];
  /** The wallet can pay for this many lookups; omitted = any number. */
  affordable?: number;
  configured?: boolean;
}

const found = (): Lookup => ({ status: 'found', data: { industry: 'Software' } });
const notFound = (): Lookup => ({ status: 'not_found', data: {} });

function build(s: Setup = {}) {
  const saved: Array<{ contactId: number; status: string }> = [];
  const events: Array<{
    aggregateModule: string;
    aggregateId: number;
    payload: Record<string, unknown>;
  }> = [];
  const asked: number[] = [];
  const answers = [...(s.answers ?? [])];
  const enrichment: GrowthEnrichmentPort = {
    provider: 'apollo',
    configured: () => s.configured ?? true,
    lookup: async () => {
      const a = answers.shift() ?? found();
      if (a instanceof Error) throw a;
      return a;
    },
  };
  const repo = {
    enrichmentCandidates: async () =>
      (s.contacts ?? [1, 2, 3]).map((id) => ({ id, email: `p${id}@acme.test` })),
    saveEnrichment: async (
      _tx: unknown,
      _org: number,
      contactId: number,
      _p: string,
      status: string,
    ) => void saved.push({ contactId, status }),
  };
  const usage = {
    assertCanAfford: async (_org: number, kind: string) => {
      asked.push(asked.length);
      expect(kind).toBe('enrichment');
      // The wallet is spent by each saved lookup, so what it can still pay for follows the saved count.
      if (s.affordable !== undefined && saved.length >= s.affordable) {
        throw new AppError(ERROR_CODES.WALLET_EMPTY, 'empty', 422);
      }
    },
  };
  const outbox = {
    emit: async (
      _tx: unknown,
      e: { aggregateModule: string; aggregateId: number; payload: Record<string, unknown> },
    ) => void events.push(e),
  };
  const db = { txAs: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn({}) };
  const gate = { require: async () => ({}) };
  const svc = new GrowthService(
    db as never,
    repo as never,
    gate as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    enrichment,
    usage as never,
    outbox as never,
  );
  return { svc, saved, events, asked };
}

describe('contact enrichment and the wallet', () => {
  it('bills one lookup per contact asked about, in the transaction that saves its answer', async () => {
    const { svc, saved, events } = build({ contacts: [11, 12], answers: [found(), notFound()] });
    expect(await svc.runEnrichment(5)).toBe(2);
    expect(saved).toEqual([
      { contactId: 11, status: 'found' },
      { contactId: 12, status: 'not_found' },
    ]);
    expect(events.map((e) => e.aggregateId)).toEqual([11, 12]);
    const today = new Date().toISOString().slice(0, 10);
    expect(events[0]!.payload).toMatchObject({
      kind: 'enrichment',
      usageId: `enrich:11:${today}`,
      units: 1,
      source: 'growth',
      provider: 'apollo',
    });
  });

  it('does not bill a lookup that failed (it gave nothing)', async () => {
    const { svc, saved, events } = build({
      contacts: [1, 2],
      answers: [new EnrichmentError('provider', 'down'), found()],
    });
    await svc.runEnrichment(5);
    expect(saved.map((x) => x.status)).toEqual(['failed', 'found']);
    expect(events.map((e) => e.aggregateId)).toEqual([2]);
  });

  it('stops the run, billing nothing for it, when the provider refuses the key or rate limits', async () => {
    const { svc, saved, events } = build({
      contacts: [1, 2, 3],
      answers: [found(), new EnrichmentError('rate_limited', 'slow down'), found()],
    });
    expect(await svc.runEnrichment(5)).toBe(1);
    expect(saved).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it('stops quietly at the first contact when the wallet cannot pay: no lookup, nothing saved, no error', async () => {
    const { svc, saved, events } = build({ affordable: 0 });
    await expect(svc.runEnrichment(5)).resolves.toBe(0);
    expect(saved).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('stops part-way when the wallet runs out, keeping what it already paid for', async () => {
    const { svc, saved, events } = build({ contacts: [1, 2, 3], affordable: 1 });
    expect(await svc.runEnrichment(5)).toBe(1);
    expect(saved).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it('does nothing, and asks nothing of the wallet, without a configured provider', async () => {
    const { svc, asked } = build({ configured: false });
    expect(await svc.runEnrichment(5)).toBe(0);
    expect(await svc.enrich(5)).toBe(0);
    expect(asked).toHaveLength(0);
  });

  it('refuses the button with 422 WALLET_EMPTY on an empty wallet, before any lookup', async () => {
    const { svc, saved } = build({ affordable: 0 });
    await expect(svc.enrich(5)).rejects.toMatchObject({ code: ERROR_CODES.WALLET_EMPTY });
    expect(saved).toHaveLength(0);
  });

  it('runs the button on a funded wallet', async () => {
    const { svc, saved } = build({ contacts: [1] });
    expect(await svc.enrich(5)).toBe(1);
    expect(saved).toHaveLength(1);
  });
});

describe('enrichmentUsageId and isBillableLookup', () => {
  it('names a lookup by the contact and the UTC day', () => {
    expect(enrichmentUsageId(42, new Date('2026-10-22T23:59:00.000Z'))).toBe(
      'enrich:42:2026-10-22',
    );
    expect(enrichmentUsageId(42, new Date('2026-10-23T00:00:00.000Z'))).toBe(
      'enrich:42:2026-10-23',
    );
  });

  it('bills a found and a not-found lookup but not a failed one', () => {
    expect(isBillableLookup('found')).toBe(true);
    expect(isBillableLookup('not_found')).toBe(true);
    expect(isBillableLookup('failed')).toBe(false);
  });
});
