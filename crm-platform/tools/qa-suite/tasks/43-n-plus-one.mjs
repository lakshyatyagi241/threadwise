// #43 N+1 query detection: a database or repository call awaited inside a loop or per-item async map.
import { apiSrc, expectNone, read, rel, unreviewed } from '../lib/core.mjs';
import { lineAt, maskCode, matchClose } from '../lib/code.mjs';
import { batchedLoop } from '../lib/loop-shape.mjs';

const DB_CALL =
  /\bawait\s+(?:this\.\w+\.(?:find|get|load|list|fetch|select|count|exists|read|lookup|resolve|insert|update|delete|create|save|upsert|remove|mark|record)\w*\(|(?:tx|rowTx|sp|trx|db)\.(?:select|insert|update|delete|execute|query)\b|(?:tx|rowTx|sp|trx)\.transaction\()/;
const LOOPS =
  /\b(for\s*(?:await\s*)?\([^)]*\)|while\s*\([^)]*\))\s*\{|\.(?:forEach|map|flatMap|filter|reduce)\(\s*async\b/g;

export default {
  id: 43,
  priority: 'P1',
  name: 'N+1 query detection',
  owner: 'Punya',
  target: '100% critical data paths reviewed; measurable before/after evidence',
  async run() {
    const loops = [],
      writes = [],
      parallel = [];
    let files = 0,
      loopCount = 0;
    for (const f of apiSrc()) {
      const raw = read(f);
      if (!/\b(for|while|forEach|map)\b/.test(raw)) continue;
      files++;
      const m = maskCode(raw);
      for (const mt of m.matchAll(LOOPS)) {
        loopCount++;
        const isMap = mt[0].startsWith('.');
        const open = isMap ? m.indexOf('(', mt.index) : mt.index + mt[0].length - 1;
        const close = matchClose(m, open);
        if (close < 0) continue;
        const body = raw.slice(open, close);
        if (!isMap && batchedLoop(mt[0], body)) continue;
        const hit = body.match(DB_CALL);
        if (!hit) continue;
        const where = `${rel(f)}:${lineAt(raw, open + hit.index)}  ${hit[0].replace(/\s+/g, ' ').slice(0, 70)}`;
        // a per-iteration query is a bug when the loop runs over request data; flagged for review either way
        (isMap
          ? parallel
          : /\.(?:insert|update|delete|execute|create|save|upsert|remove|mark|record)|tx\.transaction/.test(
                hit[0],
              )
            ? writes
            : loops
        ).push(where);
      }
    }
    const open = unreviewed(43, loops);
    const checks = [
      expectNone(
        'n1-serial-read',
        'No awaited READ (find/get/select/count) inside a loop that has not been reviewed (serial N+1)',
        open,
        { severity: 'high' },
      ),
      expectNone(
        'n1-serial-write',
        'Writes inside loops are batched or bounded (one statement per item)',
        unreviewed(43, writes),
        { level: 'warn' },
      ),
      expectNone(
        'n1-parallel',
        'No DB/repository call inside an async map/forEach (parallel N+1, still N queries)',
        unreviewed(43, parallel),
        { level: 'warn' },
      ),
    ];
    return {
      checks,
      metrics: {
        'files with loops': files,
        'loops scanned': loopCount,
        'read-in-loop suspects': loops.length,
        unreviewed: open.length,
        'write-in-loop': writes.length,
        'parallel suspects': parallel.length,
      },
      target: {
        met: open.length === 0,
        text: `${open.length} of ${loops.length} read-in-loop suspects are unreviewed. Fix them or record a reason in data/baseline.json. Measure before/after with #41/#42.`,
      },
    };
  },
};
