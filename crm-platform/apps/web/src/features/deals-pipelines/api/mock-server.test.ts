import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { resetMock } from './mock-server';
import { dealsApi } from './service';

/**
 * The in-memory stand-in must behave like the server the spec describes, because the screens can be exercised against it
 * while the real endpoints are unreachable. These run through the real service layer, so the responses are parsed by the
 * shared contracts and mapped to the view models exactly as in the app.
 */
beforeAll(() => {
  process.env.NEXT_PUBLIC_DEALS_MOCK = '1';
  resetMock();
});

async function pipeline() {
  const all = await dealsApi.pipelines();
  return all.find((p) => p.isDefault)!;
}

async function expectApiError(p: Promise<unknown>, status: number, code?: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).status).toBe(status);
  if (code) expect((err as ApiError).code).toBe(code);
}

describe('deals stand-in API through the service layer', () => {
  it('loads the whole board with column totals in the pipeline currency', async () => {
    const p = await pipeline();
    const board = await dealsApi.board(p.id, p.currency, {});
    expect(board.columns).toHaveLength(p.stages.length);
    const first = board.columns[0]!;
    expect(first.deals.length).toBeGreaterThan(0);
    expect(first.summary.count).toBeGreaterThanOrEqual(first.deals.length);
    expect(first.summary.valueMinor).toBeGreaterThan(0);
    // the weighted value of an open column is its value times the stage probability
    const stage = p.stages[0]!;
    expect(first.summary.weightedMinor).toBeCloseTo((first.summary.valueMinor * stage.probability) / 100, -1);
    expect(board.kpis.openCount).toBeGreaterThan(0);
    expect(board.kpis.winRate).toBeGreaterThanOrEqual(0);
  });

  it('pages one column with a cursor and applies the board filters', async () => {
    const p = await pipeline();
    const stage = p.stages[0]!;
    const board = await dealsApi.board(p.id, p.currency, {}, undefined, 2);
    const col = board.columns[0]!;
    expect(col.deals).toHaveLength(2);
    expect(col.hasMore).toBe(true);
    const next = await dealsApi.stagePage(stage.id, p.currency, {}, col.nextCursor ?? undefined);
    expect(next.deals.every((d) => !col.deals.some((x) => x.id === d.id))).toBe(true);

    const all = await dealsApi.board(p.id, p.currency, {});
    const some = await dealsApi.board(p.id, p.currency, { q: 'acme' });
    const count = (b: typeof all) => b.columns.reduce((n, c) => n + c.summary.count, 0);
    expect(count(some)).toBeLessThan(count(all));
    // the KPIs describe the whole pipeline, whatever the filter
    expect(some.kpis).toEqual(all.kpis);
    const none = await dealsApi.deals({ pipelineId: p.id, unassigned: 'true', source: 'ai' });
    expect(none.deals).toHaveLength(0);
  });

  it('derives status from the stage and asks for a reason to lose a deal', async () => {
    const p = await pipeline();
    const open = p.stages.find((s) => s.kind === 'open')!;
    const won = p.stages.find((s) => s.kind === 'won')!;
    const lost = p.stages.find((s) => s.kind === 'lost')!;
    const deal = await dealsApi.createDeal(
      { title: 'Flow test', pipelineId: p.id, stageId: open.id, value: '100.00' },
      p.currency,
    );
    expect(deal).toMatchObject({ status: 'open', valueMinor: 10000, currency: 'USD' });

    const wonDeal = await dealsApi.moveDeal(deal.id, { stageId: won.id });
    expect(wonDeal).toMatchObject({ status: 'won', lostAt: null });
    expect(wonDeal.wonAt).not.toBeNull();

    await expectApiError(dealsApi.moveDeal(deal.id, { stageId: lost.id }), 422, 'DEAL_LOST_REASON_REQUIRED');
    const lostDeal = await dealsApi.moveDeal(deal.id, { stageId: lost.id, lostReason: 'No budget' });
    expect(lostDeal).toMatchObject({ status: 'lost', lostReason: 'No budget', wonAt: null });

    const reopened = await dealsApi.moveDeal(deal.id, { stageId: open.id });
    expect(reopened).toMatchObject({ status: 'open', lostReason: null, lostAt: null });
  });

  it('accepts a catalogue reason by id', async () => {
    const p = await pipeline();
    const reasons = await dealsApi.lostReasons(true);
    expect(reasons.length).toBeGreaterThan(0);
    const lost = p.stages.find((s) => s.kind === 'lost')!;
    const deal = await dealsApi.createDeal({ title: 'Lose by id', pipelineId: p.id }, p.currency);
    const out = await dealsApi.moveDeal(deal.id, { stageId: lost.id, lostReasonId: reasons[0]!.id });
    expect(out.lostReason).toBe(reasons[0]!.name);
  });

  it('keeps the order a drop asked for', async () => {
    const p = await pipeline();
    const stage = p.stages[1]!;
    const ids = async () =>
      (await dealsApi.deals({ pipelineId: p.id, stageId: stage.id, limit: 50 })).deals.length;
    const board = await dealsApi.board(p.id, p.currency, {});
    const col = board.columns[1]!;
    expect(col.deals.length).toBeGreaterThan(2);
    expect(await ids()).toBe(col.deals.length);
    const last = col.deals[col.deals.length - 1]!;
    await dealsApi.moveDeal(last.id, { stageId: stage.id, beforeDealId: col.deals[0]!.id, afterDealId: null });
    const after = await dealsApi.board(p.id, p.currency, {});
    expect(after.columns[1]!.deals[0]!.id).toBe(last.id);
    // and sending only the card above puts it directly below that card
    await dealsApi.moveDeal(last.id, { stageId: stage.id, afterDealId: col.deals[0]!.id });
    const again = await dealsApi.board(p.id, p.currency, {});
    expect(again.columns[1]!.deals[1]!.id).toBe(last.id);
  });

  it('refuses a stale edit, a stage of another pipeline and an owner who is not a member', async () => {
    const p = await pipeline();
    const d = (await dealsApi.deals({ pipelineId: p.id, limit: 1 })).deals[0]!;
    await expectApiError(
      dealsApi.updateDeal({ id: d.id, rowVersion: d.rowVersion + 5 }, { title: 'x' }),
      409,
      'ROW_VERSION_CONFLICT',
    );
    await expectApiError(
      dealsApi.updateDeal(d, { ownerId: 'c0000000-0000-4000-8000-000000000000' }),
      422,
      'DEAL_OWNER_INVALID',
    );
    const other = (await dealsApi.pipelines()).find((x) => x.id !== p.id)!;
    await expectApiError(
      dealsApi.moveDeal(d.id, { stageId: other.stages[0]!.id }),
      422,
      'DEAL_STAGE_MISMATCH',
    );
  });

  it('changes a currency only together with the value', async () => {
    const p = await pipeline();
    const d = (await dealsApi.deals({ pipelineId: p.id, limit: 1 })).deals[0]!;
    await expectApiError(dealsApi.updateDeal(d, { currency: 'GBP' }), 422, 'DEAL_VALUE_INVALID');
    const out = await dealsApi.updateDeal(d, { currency: 'GBP', value: '12.50' });
    expect(out).toMatchObject({ currency: 'GBP', valueMinor: 1250 });
  });

  it('logs stage changes on the timeline and completes and reopens a task', async () => {
    const p = await pipeline();
    const d = (await dealsApi.board(p.id, p.currency, {})).columns[0]!.deals[0]!;
    await dealsApi.moveDeal(d.id, { stageId: p.stages[1]!.id });
    const task = await dealsApi.addActivity(d.id, {
      type: 'task',
      body: 'Call back',
      dueAt: new Date().toISOString(),
    });
    const list = await dealsApi.activities(d.id);
    expect(list.some((a) => a.type === 'stage_change' && a.stageChange?.to === p.stages[1]!.name)).toBe(true);
    expect((await dealsApi.setTaskDone(d.id, task.id, true)).done).toBe(true);
    expect((await dealsApi.setTaskDone(d.id, task.id, false)).done).toBe(false);
    await expectApiError(
      dealsApi.addActivity(d.id, { type: 'note', body: 'x', dueAt: new Date().toISOString() }),
      422,
    );
  });

  it('allows one won and one lost stage, and asks where deals go before a stage or pipeline is deleted', async () => {
    const p = await pipeline();
    await expectApiError(
      dealsApi.createStage(p.id, { name: 'Second won', color: '#16A34A', probability: 100, kind: 'won' }),
      409,
      'DEAL_STAGE_KIND_TAKEN',
    );
    const created = await dealsApi.createStage(p.id, {
      name: 'Contract sent',
      color: '#0EA5E9',
      probability: 60,
      kind: 'open',
    });
    const refreshed = (await dealsApi.pipelines()).find((x) => x.id === p.id)!;
    const idx = refreshed.stages.findIndex((s) => s.id === created.id);
    expect(refreshed.stages.slice(idx + 1).every((s) => s.kind !== 'open')).toBe(true);

    const withDeals = refreshed.stages.find((s) => s.dealCount > 0 && s.kind === 'open')!;
    await expectApiError(dealsApi.deleteStage(withDeals.id), 409, 'DEAL_STAGE_HAS_DEALS');
    await expectApiError(
      dealsApi.updateStage(withDeals, { kind: 'lost' }),
      409,
    );
    await dealsApi.deleteStage(withDeals.id, created.id);
    const after = await dealsApi.board(p.id, p.currency, {});
    expect(after.columns.some((c) => c.stageId === withDeals.id)).toBe(false);
    expect(after.columns.find((c) => c.stageId === created.id)!.summary.count).toBeGreaterThan(0);

    const all = await dealsApi.pipelines();
    const secondary = all.find((x) => !x.isDefault)!;
    await expectApiError(dealsApi.deletePipeline(p.id), 409, 'DEAL_PIPELINE_DEFAULT_PROTECTED');
    await expectApiError(dealsApi.deletePipeline(secondary.id), 409, 'DEAL_PIPELINE_HAS_DEALS');
    await dealsApi.deletePipeline(secondary.id, p.id);
    expect((await dealsApi.pipelines()).some((x) => x.id === secondary.id)).toBe(false);
  });

  it('builds a report with six month buckets, converted totals and no value in won or lost stages', async () => {
    const p = await pipeline();
    const r = await dealsApi.report({}, p.currency);
    expect(r.months).toHaveLength(6);
    expect(r.months[0]!.month < r.months[5]!.month).toBe(true);
    expect(r.winRate).toBeGreaterThanOrEqual(0);
    expect(r.winRate).toBeLessThanOrEqual(100);
    expect(r.byStage.filter((s) => s.kind !== 'open').every((s) => s.valueMinor === 0)).toBe(true);
    expect(r.forecastMinor).toBeLessThanOrEqual(r.openValueMinor);
    const narrow = await dealsApi.report({ from: '2999-01-01', to: '2999-12-31' }, p.currency);
    expect(narrow.wonCount).toBe(0);
  });

  it('keeps the lost-reason catalogue and the setting', async () => {
    const added = await dealsApi.createLostReason('Went with in-house');
    const renamed = await dealsApi.updateLostReason(added, { name: 'Built in-house' });
    expect(renamed.name).toBe('Built in-house');
    const off = await dealsApi.updateLostReason(renamed, { isActive: false });
    expect((await dealsApi.lostReasons(true)).some((r) => r.id === off.id)).toBe(false);
    expect((await dealsApi.lostReasons(false)).some((r) => r.id === off.id)).toBe(true);
    await dealsApi.deleteLostReason(off.id);
    const s = await dealsApi.saveSettings(false);
    expect(s.lostReasonRequired).toBe(false);
    await dealsApi.saveSettings(true);
  });
});
