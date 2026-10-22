// LOCAL FAKE of Google Chat: POST /hook/<space> stores the card; GET / renders 4 spaces.
import http from 'node:http';
const SP = { critical: 'Critical', other: 'Other', slowquery: 'Slow Queries', deploy: 'Deployments' };
const msgs = Object.fromEntries(Object.keys(SP).map((k) => [k, []]));
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const text = (m) => {
  const out = [];
  if (m.text) out.push(m.text);
  for (const c of m.cardsV2 ?? m.cards ?? []) {
    const card = c.card ?? c; const h = card.header;
    if (h) out.push(`${h.title ?? ''} | ${h.subtitle ?? ''}`);
    for (const s of card.sections ?? []) for (const w of s.widgets ?? []) {
      if (w.textParagraph) out.push(w.textParagraph.text.replace(/<br>/g, '\n'));
      if (w.decoratedText) out.push(`${w.decoratedText.topLabel ?? ''} ${w.decoratedText.text ?? ''}`);
      if (w.buttonList) out.push('[' + w.buttonList.buttons.map((b) => b.text).join('] [') + ']');
      if (w.buttons) out.push('[' + w.buttons.map((b) => b.textButton?.text).join('] [') + ']');
    }
  }
  return out.length ? out.join('\n') : JSON.stringify(m);
};
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'POST' && u.pathname.startsWith('/hook/')) {
    const sp = u.pathname.slice(6); let raw = ''; for await (const c of req) raw += c;
    if (!msgs[sp]) { res.writeHead(404); return res.end('{}'); }
    let j; try { j = JSON.parse(raw); } catch { j = { text: raw }; }
    msgs[sp].unshift({ at: new Date().toISOString(), body: j }); msgs[sp].length = Math.min(msgs[sp].length, 100);
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"name":"fake"}');
  }
  if (u.pathname === '/api.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(msgs)); }
  const cols = Object.entries(SP).map(([k, n]) => `<section><h2>${n} (${msgs[k].length})</h2>${msgs[k].map((m) => `<pre><b>${m.at}</b>\n${esc(text(m.body))}</pre>`).join('') || '<i>no messages</i>'}</section>`).join('');
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><meta charset=utf-8><meta http-equiv=refresh content=3><title>LOCAL FAKE of Google Chat</title><style>body{font:13px sans-serif;margin:8px}h1{color:#b00}main{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}section{border:1px solid #888;padding:6px;overflow:hidden}pre{white-space:pre-wrap;background:#eef;padding:4px;margin:4px 0}</style><h1>LOCAL FAKE of Google Chat (not real Google Chat)</h1><main>${cols}</main>`);
}).listen(59611, '0.0.0.0');
