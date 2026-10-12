import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FaqApi,
  indexAll,
  setPlatformKey,
  startPipeline,
  type DecisionJson,
  type EntryJson,
  type Pipeline,
  type Tenant,
} from './support';

/**
 * The FAQ engine against the REAL vendor: real OpenRouter embeddings of real text, stored as halfvec in real Postgres, matched by the
 * real SQL. Opt-in (it spends a few cents and needs the network): set FAQ_LIVE_OPENROUTER_KEY to an OpenRouter key and run
 *   FAQ_LIVE_OPENROUTER_KEY=sk-or-... pnpm --filter @crm/api exec vitest run --dir test/e2e test/e2e/faq-knowledge/faq.live
 * The key is only read from the environment, saved into the throw-away test database, and never written anywhere else.
 *
 * Dataset: fixtures/eval-faqs.json, the one the embedding model was chosen on (16 FAQs of 5 variations each, 80 held-out customer
 * phrasings with typos and romanised Hindi, 30 off-topic messages). The bars below are looser than the offline evaluation's results so
 * a vendor-side wobble does not fail the build, and tight enough that a broken pipeline (wrong column type, truncated vectors, a
 * reversed distance operator) cannot pass.
 */
const KEY = process.env.FAQ_LIVE_OPENROUTER_KEY;

interface Data {
  faqs: Array<{ id: string; q: string; vars: string[]; tests: string[] }>;
  negatives: string[];
}
const data = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/eval-faqs.json'), 'utf8'),
) as Data;

describe.skipIf(!KEY)('live OpenRouter', () => {
  let p: Pipeline;
  let api: FaqApi;
  let t: Tenant;
  const entries = new Map<string, EntryJson>();

  beforeAll(async () => {
    p = await startPipeline({ live: true });
    api = new FaqApi(p.h);
    await setPlatformKey(p, true, KEY!);
    t = await api.signup('faqlive');
    for (const f of data.faqs) {
      entries.set(
        f.id,
        await api.entry(t.admin, f.q, { variations: f.vars, answerText: `Answer ${f.id}` }),
      );
    }
    await api
      .faq(t.admin)
      .saveSettings({ enabled: true, threshold: 0.5, minMargin: 0, logQueries: true });
  }, 400_000);
  afterAll(async () => {
    await p?.stop();
  });

  it('indexes every variation with real 3072-wide vectors and records real token usage', async () => {
    const expected = data.faqs.reduce((n, f) => n + 1 + f.vars.length, 0);
    await indexAll(p, 20);
    const rows = await p.h.owner.query(
      `SELECT count(*) AS n, min(vector_dims(embedding)) AS lo, max(vector_dims(embedding)) AS hi,
              count(*) FILTER (WHERE embed_state = 'ready') AS ready
       FROM faq_variations WHERE org_id = $1`,
      [t.orgId],
    );
    expect(Number(rows.rows[0].n)).toBe(expected);
    expect(Number(rows.rows[0].ready)).toBe(expected);
    expect(Number(rows.rows[0].lo)).toBe(3072);
    expect(Number(rows.rows[0].hi)).toBe(3072);
    const ledger = await p.h.owner.query(
      `SELECT sum(prompt_tokens) AS tokens, count(*) AS calls FROM ai_token_usage WHERE org_id = $1 AND provider = 'openrouter' AND model = 'openai/text-embedding-3-large'`,
      [t.orgId],
    );
    expect(Number(ledger.rows[0].tokens)).toBeGreaterThan(expected);
    console.log(
      `[live] indexed ${expected} variations, ${ledger.rows[0].tokens} tokens in ${ledger.rows[0].calls} call(s)`,
    );
  });

  it('finds the right FAQ for held-out phrasings, answers most of them, and stays quiet on off-topic messages', async () => {
    const ask = async (q: string): Promise<DecisionJson> => {
      const res = await api.faq(t.admin).test(q);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body as DecisionJson;
    };
    let top1 = 0;
    let answeredRight = 0;
    let answeredWrong = 0;
    let positives = 0;
    const misses: string[] = [];
    for (const f of data.faqs) {
      for (const q of f.tests) {
        positives++;
        const d = await ask(q);
        const best = d.candidates[0];
        if (best && best.faqId === entries.get(f.id)!.id) top1++;
        else misses.push(`${q} -> ${best?.question}`);
        if (d.outcome === 'answered') {
          if (d.faqId === entries.get(f.id)!.id) answeredRight++;
          else answeredWrong++;
        }
      }
    }
    let negativeAnswered = 0;
    const leaks: string[] = [];
    for (const q of data.negatives) {
      const d = await ask(q);
      if (d.outcome === 'answered') {
        negativeAnswered++;
        leaks.push(`${q} -> ${d.candidates[0]?.question} (${d.score})`);
      }
    }
    const accepted = answeredRight + answeredWrong + negativeAnswered;
    const precision = accepted === 0 ? 1 : answeredRight / accepted;
    const coverage = answeredRight / positives;
    console.log(
      `[live] top1 ${top1}/${positives}, answered right ${answeredRight}, wrong ${answeredWrong}, off-topic answered ${negativeAnswered}/${data.negatives.length}, precision ${(precision * 100).toFixed(1)}%, coverage ${(coverage * 100).toFixed(1)}%`,
    );
    if (misses.length) console.log('[live] top-1 misses:', misses.slice(0, 6));
    if (leaks.length) console.log('[live] off-topic answered:', leaks.slice(0, 6));
    expect(top1 / positives).toBeGreaterThanOrEqual(0.95);
    expect(precision).toBeGreaterThanOrEqual(0.93);
    expect(coverage).toBeGreaterThanOrEqual(0.55);
    expect(negativeAnswered).toBeLessThanOrEqual(3);
  }, 300_000);

  it('the borderline check with a real model: the known off-topic leak is withheld and right answers survive', async () => {
    const f = api.faq(t.admin);
    const cur = (await f.settings()).body;
    const on = await f.saveSettings({
      enabled: true,
      threshold: 0.5,
      minMargin: 0,
      logQueries: true,
      verifyMode: 'borderline',
      verifyBand: 0.15,
      rowVersion: cur.rowVersion,
    });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    try {
      const ask = async (
        q: string,
      ): Promise<DecisionJson & { verify: { verdict: string; reason: string | null } | null }> => {
        const res = await f.test(q);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        return res.body;
      };
      const tally: Record<string, number> = { confirmed: 0, rejected: 0, error: 0, skipped: 0 };
      let answeredRight = 0;
      let answeredWrong = 0;
      let vetoedRight = 0;
      const vetoes: string[] = [];
      let positives = 0;
      for (const fa of data.faqs) {
        for (const q of fa.tests) {
          positives++;
          const d = await ask(q);
          if (d.verify) tally[d.verify.verdict] = (tally[d.verify.verdict] ?? 0) + 1;
          const right = d.candidates[0]?.faqId === entries.get(fa.id)!.id;
          if (d.outcome === 'answered') right ? answeredRight++ : answeredWrong++;
          if (d.verify?.verdict === 'rejected' && right) {
            vetoedRight++;
            vetoes.push(`${q} -> ${d.candidates[0]?.question} (${d.score}): ${d.verify.reason}`);
          }
        }
      }
      let negativeAnswered = 0;
      const leaks: string[] = [];
      for (const q of data.negatives) {
        const d = await ask(q);
        if (d.verify) tally[d.verify.verdict] = (tally[d.verify.verdict] ?? 0) + 1;
        if (d.outcome === 'answered') {
          negativeAnswered++;
          leaks.push(`${q} -> ${d.candidates[0]?.question} (${d.score})`);
        }
      }
      const pizza = await ask('send me a pizza');
      console.log(
        `[live] with the check: answered right ${answeredRight}/${positives}, wrong ${answeredWrong}, right answers vetoed ${vetoedRight}, off-topic answered ${negativeAnswered}/${data.negatives.length}; verdicts ${JSON.stringify(tally)}`,
      );
      console.log(
        `[live] "send me a pizza": ${pizza.outcome}, best ${pizza.candidates[0]?.question} (${pizza.score}), verify ${JSON.stringify(pizza.verify)}`,
      );
      if (vetoes.length) console.log('[live] right answers vetoed:', vetoes);
      if (leaks.length) console.log('[live] off-topic still answered:', leaks);
      // The check only ever removes answers, so it cannot make precision worse; it must remove the leak without costing real answers.
      expect(answeredWrong).toBe(0);
      expect(negativeAnswered).toBeLessThanOrEqual(1);
      expect(pizza.outcome).not.toBe('answered');
      expect(vetoedRight).toBeLessThanOrEqual(Math.ceil(positives * 0.1));
      expect(tally.error).toBe(0);
      expect((tally.confirmed ?? 0) + (tally.rejected ?? 0)).toBeGreaterThan(0);
      const ledger = await p.h.owner.query(
        `SELECT count(*) AS calls, sum(prompt_tokens) AS p, sum(completion_tokens) AS c FROM ai_token_usage
       WHERE org_id = $1 AND model = 'openai/gpt-4o-mini' AND completion_tokens > 0`,
        [t.orgId],
      );
      expect(Number(ledger.rows[0].calls)).toBeGreaterThan(0);
      console.log(
        `[live] check cost: ${ledger.rows[0].calls} calls, ${ledger.rows[0].p} prompt + ${ledger.rows[0].c} completion tokens`,
      );
    } finally {
      const after = (await f.settings()).body;
      await f.saveSettings({
        enabled: true,
        threshold: 0.5,
        minMargin: 0,
        logQueries: true,
        verifyMode: 'off',
        rowVersion: after.rowVersion,
      });
    }
  }, 600_000);

  it('serves a repeated message from the query cache without paying for it twice', async () => {
    const q = 'is it possible to cancel the thing i bought this morning';
    await api.faq(t.admin).test(q);
    const after1 = Number(
      (
        await p.h.owner.query(`SELECT count(*) AS n FROM ai_token_usage WHERE org_id = $1`, [
          t.orgId,
        ])
      ).rows[0].n,
    );
    const again = await api.faq(t.admin).test(q);
    const after2 = Number(
      (
        await p.h.owner.query(`SELECT count(*) AS n FROM ai_token_usage WHERE org_id = $1`, [
          t.orgId,
        ])
      ).rows[0].n,
    );
    expect(again.status).toBe(200);
    expect(after2).toBe(after1);
  });

  it('a real model writes usable suggestions, nothing is saved, and the cost is recorded', async () => {
    const e = entries.get('track')!;
    const res = await api.faq(t.admin).generate(e.id, { count: 6 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.suggestions.length).toBeGreaterThanOrEqual(3);
    expect(new Set(res.body.suggestions.map((s: string) => s.toLowerCase())).size).toBe(
      res.body.suggestions.length,
    );
    console.log('[live] suggestions:', res.body.suggestions);
    const ledger = await p.h.owner.query(
      `SELECT sum(completion_tokens) AS c FROM ai_token_usage WHERE org_id = $1 AND model = 'openai/gpt-4o-mini'`,
      [t.orgId],
    );
    expect(Number(ledger.rows[0].c)).toBeGreaterThan(0);
    const after = (await api.faq(t.admin).get(e.id)).body as EntryJson;
    expect(after.variationCount).toBe(e.variationCount);
  });

  it('a refused key is reported plainly: the variation waits with the reason and the vendor body never leaks', async () => {
    await setPlatformKey(p, true, 'sk-or-v1-this-is-not-a-real-key');
    const bad = await api.signup('faqlivebad');
    const e = await api.entry(bad.admin, 'Does a bad key break me?');
    await indexAll(p, 1);
    const got = (await api.faq(bad.admin).get(e.id)).body as EntryJson;
    expect(got.variations![0]!.embedState).toBe('pending');
    expect(got.variations![0]!.embedError).toMatch(/refused the key/);
    expect(JSON.stringify(got)).not.toContain('this-is-not-a-real-key');
    const gen = await api.faq(bad.admin).generate(e.id);
    expect(gen.status).toBe(422);
    await setPlatformKey(p, true, KEY!);
  });
});
