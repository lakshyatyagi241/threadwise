import fs from 'node:fs';
const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error('Set OPENROUTER_API_KEY');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const models = process.argv.slice(2);
const docs = []; // {faq,text}
for (const f of data.faqs) {
  docs.push({ faq: f.id, text: f.q });
  for (const v of f.vars) docs.push({ faq: f.id, text: v });
}
const queries = [];
for (const f of data.faqs) for (const t of f.tests) queries.push({ faq: f.id, text: t });
for (const n of data.negatives) queries.push({ faq: null, text: n });
async function embed(model, texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64);
    for (let attempt = 0; ; attempt++) {
      const r = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, input: batch }),
        signal: AbortSignal.timeout(60000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.data) {
        for (const d of j.data.sort((a, b) => a.index - b.index)) out.push(d.embedding);
        break;
      }
      if (attempt >= 2) throw new Error(`${model}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
      await new Promise((s) => setTimeout(s, 1500));
    }
  }
  return out;
}
const norm = (v) => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
};
const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
const results = [];
for (const model of models) {
  try {
    const t0 = Date.now();
    const D = (
      await embed(
        model,
        docs.map((d) => d.text),
      )
    ).map(norm);
    const Q = (
      await embed(
        model,
        queries.map((q) => q.text),
      )
    ).map(norm);
    const ms = Date.now() - t0;
    const rows = queries.map((q, i) => {
      const best = {};
      D.forEach((d, j) => {
        const s = dot(Q[i], d);
        const f = docs[j].faq;
        if (!(f in best) || s > best[f]) best[f] = s;
      });
      const ranked = Object.entries(best).sort((a, b) => b[1] - a[1]);
      return {
        q,
        top: ranked[0][0],
        score: ranked[0][1],
        second: ranked[1][1],
        top3: ranked.slice(0, 3).map((r) => r[0]),
      };
    });
    const pos = rows.filter((r) => r.q.faq),
      neg = rows.filter((r) => !r.q.faq);
    const top1 = pos.filter((r) => r.top === r.q.faq).length / pos.length;
    const rec3 = pos.filter((r) => r.top3.includes(r.q.faq)).length / pos.length;
    // threshold sweep: accept if score>=t. correct accept = top1 correct. wrong accept = positive wrong or negative accepted.
    let bestT = null,
      sweep = [];
    for (let t = 0.3; t <= 0.95; t += 0.01) {
      const acc = rows.filter((r) => r.score >= t);
      const good = acc.filter((r) => r.q.faq && r.top === r.q.faq).length;
      const bad = acc.length - good;
      const prec = acc.length ? good / acc.length : 1;
      const cov = good / pos.length;
      sweep.push({ t: +t.toFixed(2), prec, cov, bad });
      if (prec >= 0.95 && (!bestT || cov > bestT.cov)) bestT = { t: +t.toFixed(2), prec, cov, bad };
    }
    // separability: gap between median correct score and 90th percentile negative score
    const pct = (a, p) =>
      a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
    const posOk = pos.filter((r) => r.top === r.q.faq).map((r) => r.score);
    results.push({
      sweep: sweep.filter((x) => Math.round(x.t * 100) % 2 === 0),
      model,
      dims: D[0].length,
      top1,
      rec3,
      negP90: pct(
        neg.map((r) => r.score),
        0.9,
      ),
      negMax: Math.max(...neg.map((r) => r.score)),
      posMedian: pct(posOk, 0.5),
      posP10: pct(posOk, 0.1),
      bestT,
      ms,
      wrong: pos
        .filter((r) => r.top !== r.q.faq)
        .map((r) => `${r.q.text} -> ${r.top} (want ${r.q.faq})`)
        .slice(0, 6),
    });
  } catch (e) {
    results.push({ model, error: String(e.message || e) });
  }
}
fs.writeFileSync(`out-${Date.now()}.json`, JSON.stringify(results, null, 1));
for (const r of results) {
  if (r.sweep) {
    console.log(r.model);
    for (const x of r.sweep.filter((x) => x.t >= 0.3 && x.t <= 0.8))
      console.log(
        '  t=' +
          x.t.toFixed(2) +
          ' precision=' +
          (x.prec * 100).toFixed(0) +
          '% coverage=' +
          (x.cov * 100).toFixed(0) +
          '% wrong=' +
          x.bad,
      );
  }
  if (r.error) {
    console.log(r.model, 'ERROR', r.error);
    continue;
  }
  console.log(
    `${r.model} dims=${r.dims} top1=${(r.top1 * 100).toFixed(1)}% rec@3=${(r.rec3 * 100).toFixed(1)}% posMed=${r.posMedian.toFixed(2)} posP10=${r.posP10.toFixed(2)} negP90=${r.negP90.toFixed(2)} negMax=${r.negMax.toFixed(2)} best@prec95: ${r.bestT ? `t=${r.bestT.t} coverage=${(r.bestT.cov * 100).toFixed(0)}%` : 'none'} ${r.ms}ms`,
  );
}
