// In-memory stand-in for apps-script.gs, to rehearse the whole pipeline without a real Google Sheet.
//   node qa-daily/mock-sheet.mjs [port]   then   export QA_SHEET_URL=http://localhost:8799 QA_SHEET_TOKEN=mock
// GET /rows returns the table so you can look at what the pipeline wrote.
import { createServer } from 'node:http';

const TOKEN = process.env.QA_SHEET_TOKEN ?? 'mock';
const rows = new Map();
const runs = [];
const RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
const toRow = (b) => ({
  ID: b.id,
  Date: b.date,
  Page: b.route,
  Severity: b.severity,
  Type: b.kind,
  Bug: b.title,
  Description: b.description,
  'Suggested fix': b.suggestedFix,
  Status: 'Open',
  Env: b.env ?? '',
  Area: b.area ?? '',
  Test: b.test ?? '',
  Attempts: 1,
  Updated: now(),
});

function handle(req) {
  if (req.token !== TOKEN) return { error: 'unauthorized' };
  switch (req.action) {
    case 'add': {
      let added = 0,
        reopened = 0,
        skipped = 0;
      for (const b of req.bugs ?? []) {
        const r = rows.get(b.id);
        if (!r) {
          rows.set(b.id, toRow(b));
          added++;
        } else if (r.Status === 'Verified') {
          r.Status = 'Open';
          r.Attempts++;
          reopened++;
        } else skipped++;
      }
      return { added, reopened, skipped };
    }
    case 'open':
      return {
        bugs: [...rows.values()]
          .filter((r) => r.Status === 'Open' && (!req.env || r.Env === req.env))
          .sort((a, b) => RANK[a.Severity] - RANK[b.Severity])
          .slice(0, req.limit || 5),
      };
    case 'claim': {
      const r = rows.get(req.id);
      if (!r || r.Status !== 'Open') return { ok: false };
      r.Status = 'In progress';
      r.Owner = req.owner;
      return { ok: true };
    }
    case 'mark':
    case 'resolve': {
      const r = rows.get(req.id);
      if (!r) return { ok: false, error: 'unknown id' };
      r.Status = req.status;
      r.Note = req.note ?? '';
      if (req.prUrl) r['Fix PR'] = req.prUrl;
      if (req.afterImageB64) r['After screenshot'] = `${req.afterImageB64.length} base64 chars`;
      if (req.status === 'Verified') r['Verified on'] = now();
      if (req.status === 'Open') r.Attempts++;
      return { ok: true };
    }
    case 'fixed':
      return {
        rows: [...rows.values()].filter(
          (r) => String(r.Status).startsWith('Fixed') && (!req.env || r.Env === req.env),
        ),
      };
    case 'summary': {
      const byStatus = {};
      for (const r of rows.values()) byStatus[r.Status] = (byStatus[r.Status] ?? 0) + 1;
      return { byStatus, verified: [...rows.values()].filter((r) => r.Status === 'Verified') };
    }
    case 'log':
      runs.push(req);
      return { ok: true };
    default:
      return { error: 'unknown action' };
  }
}

createServer((q, s) => {
  let body = '';
  q.on('data', (d) => (body += d));
  q.on('end', () => {
    s.setHeader('content-type', 'application/json');
    if (q.method === 'GET')
      return s.end(JSON.stringify({ rows: [...rows.values()], runs }, null, 2));
    try {
      s.end(JSON.stringify(handle(JSON.parse(body))));
    } catch (e) {
      s.end(JSON.stringify({ error: String(e) }));
    }
  });
}).listen(Number(process.argv[2] ?? 8799), () =>
  console.log(`mock sheet on :${process.argv[2] ?? 8799} (token ${TOKEN})`),
);
