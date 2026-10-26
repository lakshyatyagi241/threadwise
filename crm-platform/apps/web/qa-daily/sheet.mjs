// Talks to the Apps Script web app in apps-script.gs.
//   node qa-daily/sheet.mjs push [bugs.json]      add today's bugs (default: out/<today>/bugs.json)
//   node qa-daily/sheet.mjs open [n]              print the n most severe Open bugs
//   node qa-daily/sheet.mjs mark <id> <status> [note]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const URL_ = process.env.QA_SHEET_URL;
const TOKEN = process.env.QA_SHEET_TOKEN;

export async function call(action, payload = {}) {
  if (!URL_ || !TOKEN) throw new Error('Set QA_SHEET_URL and QA_SHEET_TOKEN (see qa-daily/README.md)');
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' }, // text/plain avoids a CORS preflight Apps Script cannot answer
    body: JSON.stringify({ token: TOKEN, action, ...payload }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) throw new Error(`sheet ${action} failed: ${res.status} ${data?.error ?? ''}`);
  return data;
}

async function push(file) {
  const date = new Date().toISOString().slice(0, 10);
  const path = file ?? join('qa-daily/out', date, 'bugs.json');
  const root = dirname(dirname(path)); // screenshot paths in bugs.json start with the date folder
  const bugs = JSON.parse(readFileSync(path, 'utf8')).map((b) => {
    let imageB64 = '';
    try {
      imageB64 = readFileSync(join(root, b.screenshot)).toString('base64');
    } catch {
      /* shot missing: the row still lands without a picture */
    }
    return { ...b, imageB64 };
  });
  const total = { added: 0, reopened: 0, skipped: 0 };
  for (let i = 0; i < bugs.length; i += 5) { // small batches keep each request fast
    const r = await call('add', { bugs: bugs.slice(i, i + 5) });
    for (const k of Object.keys(total)) total[k] += r[k];
  }
  console.log(`sheet: ${total.added} added, ${total.reopened} reopened, ${total.skipped} already known`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'push') await push(a);
  else if (cmd === 'open') console.log(JSON.stringify((await call('open', { limit: Number(a) || 5 })).bugs, null, 2));
  else if (cmd === 'mark') console.log(await call('mark', { id: a, status: b, note: c }));
  else {
    console.error('usage: sheet.mjs push|open|mark');
    process.exit(2);
  }
}
