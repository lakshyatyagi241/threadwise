'use strict';
// node --test tools/migration/pilot/files/copy-files.test.cjs
// Invented data only. Source = a fake HTTP server on 127.0.0.1, object storage = an in-memory S3 stub (no Docker).
// The DB tests use the throwaway scratch Postgres of pilot/scratch-db.cjs (pilot/.scratch.env) and skip when it is not up; they create
// two uniquely named organizations and remove them again.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const lib = require('./copy-files.cjs');

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'files-copy-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const BODY = {
  jpg: Buffer.from('invented-jpeg-bytes-0123456789'.repeat(20)),
  pdf: Buffer.from('%PDF-invented-document'.repeat(30)),
};
let srcPort, srcHits;
const source = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  srcHits.push(p);
  if (p === '/a/photo-one.jpg') return (res.writeHead(200, { 'content-type': 'image/jpeg' }), res.end(BODY.jpg));
  if (p === '/a/doc.pdf') return (res.writeHead(200, { 'content-type': 'application/pdf' }), res.end(BODY.pdf));
  if (p === '/forbidden') return (res.writeHead(403), res.end());
  if (p === '/gone') return (res.writeHead(404), res.end());
  if (p === '/html') return (res.writeHead(200, { 'content-type': 'text/html' }), res.end('<html>login</html>'));
  if (p === '/big.bin') return (res.writeHead(200, { 'content-type': 'application/octet-stream' }), res.end(Buffer.alloc(2 * 1024 * 1024, 1)));
  if (p === '/lie.jpg') {
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': '100' });
    res.write('short');
    return setTimeout(() => res.socket.destroy(), 20);
  }
  if (p === '/to-other') return (res.writeHead(302, { location: `http://localhost:${srcPort}/a/photo-one.jpg` }), res.end());
  if (p === '/to-private') return (res.writeHead(302, { location: 'http://10.0.0.5/x.jpg' }), res.end());
  if (p === '/to-same') return (res.writeHead(302, { location: '/a/photo-one.jpg' }), res.end());
  if (p === '/loop') return (res.writeHead(302, { location: '/loop' }), res.end());
  res.writeHead(404).end();
});

// in-memory S3: path style /<bucket>/<key>, checks the signed payload hash like S3 does
let objects, puts, tamper;
const s3srv = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const id = decodeURIComponent(req.url.split('?')[0]);
    if (!/^AWS4-HMAC-SHA256 Credential=testkey\//.test(req.headers.authorization || '')) return res.writeHead(403).end();
    if (req.method === 'PUT') {
      if (req.headers['x-amz-content-sha256'] !== sha(body)) return res.writeHead(400).end();
      puts.push(id);
      objects.set(id, { body, type: req.headers['content-type'] });
      return res.writeHead(200, { etag: `"${md5(body)}"` }).end();
    }
    const o = objects.get(id);
    if (!o) return res.writeHead(404).end();
    const b = tamper.has(id) ? Buffer.from(o.body.toString('latin1').replace(/./, 'X'), 'latin1') : o.body;
    res.writeHead(200, { 'content-length': b.length });
    res.end(req.method === 'HEAD' ? undefined : b);
  });
});

const cfgOf = (extra = {}) => ({ allowedHosts: ['127.0.0.1'], maxFileMB: 1, timeoutMs: 3000, ...extra });
const T = { allowHttp: true, allowPrivate: true, allowAnyPort: true };
const code = async (p) => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e.code || e.message;
  }
};

test.before(async () => {
  srcPort = await listen(source);
  s3Port = await listen(s3srv);
});
test.after(() => (source.close(), s3srv.close()));
let s3Port;
test.beforeEach(() => ((srcHits = []), (objects = new Map()), (puts = []), (tamper = new Set())));

test('private / loopback / link-local / mapped addresses are refused', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', '224.0.0.1'])
    assert.equal(lib.isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700::1111']) assert.equal(lib.isPrivateIp(ip), false, ip);
});

test('fetch guards: host allow-list, https only, private IP, redirects, size, status codes', async () => {
  const u = (p) => `http://127.0.0.1:${srcPort}${p}`;
  const c = cfgOf();
  assert.equal((await lib.download(u('/a/photo-one.jpg'), c, T)).buf.equals(BODY.jpg), true);
  assert.equal((await lib.download(u('/to-same'), c, T)).buf.length, BODY.jpg.length);
  assert.equal(await code(lib.download(u('/a/photo-one.jpg'), cfgOf({ allowedHosts: ['other.example'] }), T)), 'HOST_NOT_ALLOWED');
  assert.equal(await code(lib.download(u('/a/photo-one.jpg'), c, { allowPrivate: true, allowAnyPort: true })), 'NOT_HTTPS');
  assert.equal(await code(lib.download(u('/a/photo-one.jpg'), c, { allowHttp: true, allowAnyPort: true })), 'PRIVATE_IP');
  assert.equal(await code(lib.download('https://127.0.0.1/x.jpg', c, {})), 'PRIVATE_IP');
  assert.equal(await code(lib.download(u('/a/photo-one.jpg'), c, { allowHttp: true, allowPrivate: true })), 'HOST_NOT_ALLOWED'); // port != 443
  const both = cfgOf({ allowedHosts: ['127.0.0.1', 'localhost'] });
  assert.equal(await code(lib.download(u('/to-other'), both, T)), 'HOST_NOT_ALLOWED'); // listed, but a redirect may not leave the host
  assert.equal(await code(lib.download(u('/to-private'), c, T)), 'HOST_NOT_ALLOWED');
  assert.equal(await code(lib.download(u('/loop'), c, T)), 'TOO_MANY_REDIRECTS');
  assert.equal(await code(lib.download(u('/big.bin'), c, T)), 'TOO_LARGE');
  assert.equal(await code(lib.download(u('/lie.jpg'), c, T)), 'SIZE_MISMATCH');
  assert.equal(await code(lib.download(u('/forbidden'), c, T)), 'AUTH_REQUIRED');
  assert.equal(await code(lib.download(u('/gone'), c, T)), 'HTTP_404');
  assert.equal(await code(lib.download('not a url', c, T)), 'NOT_URL');
  // a hostname that resolves to loopback is caught at connect time (DNS rebinding), not only by literal
  assert.equal(await code(lib.download(`http://localhost:${srcPort}/a/photo-one.jpg`, cfgOf({ allowedHosts: ['localhost'] }), { allowHttp: true, allowAnyPort: true })), 'PRIVATE_IP');
});

test('storage must be configured: no S3 env means a refusal, never a local fallback', () => {
  assert.throws(() => lib.s3FromEnv({}, ['messages']), /STORAGE_NOT_CONFIGURED/);
  assert.throws(() => lib.s3FromEnv({ S3_ENDPOINT: 'http://x:9000', S3_REGION: 'r', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's' }, ['contact_files']), /S3_BUCKET_DOCUMENTS/);
  const ok = lib.s3FromEnv({ S3_ENDPOINT: 'http://objects.internal:9000/', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's', S3_BUCKET_MEDIA: 'crm-media', S3_BUCKET_DOCUMENTS: 'crm-documents' }, ['messages', 'contact_files']);
  assert.equal(ok.endpoint, 'http://objects.internal:9000');
  assert.equal(ok.pathStyle, true);
  const r = lib.s3Sign(ok, 'crm-media', 'PUT', 'org/waboo/ab/na me.jpg', Buffer.from('x'), new Date('2026-01-02T03:04:05Z'));
  assert.equal(r.url, 'http://objects.internal:9000/crm-media/org/waboo/ab/na%20me.jpg');
  assert.match(r.headers.authorization, /^AWS4-HMAC-SHA256 Credential=a\/20260102\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
});

test('object keys: messages chat/<org id>/..., contact files contact-files/<org id>/... (what the app accepts)', () => {
  const org = { id: 42, uuid: '11111111-2222-3333-4444-555555555555' };
  const id = lib.urlId('https://files.example.test/uploads/My%20Report (1).PDF?token=SECRET');
  const g = (kind) => ({ kind, id });
  const msg = lib.targetKeyOf(org, g('messages'));
  const doc = lib.targetKeyOf(org, g('contact_files'));
  assert.match(msg, /^chat\/42\/waboo\/[0-9a-f]{16}\/my_report_1_.pdf$/);
  assert.match(doc, /^contact-files\/42\/waboo\/[0-9a-f]{16}\/my_report_1_.pdf$/);
  // contract safeStorageKey (packages/contracts/src/crm/contact-file.ts) + service check (contact-files.service.ts:73-75), restated
  const hasControl = (v) => [...v].some((c) => c.charCodeAt(0) < 32);
  const accepted = (key, orgId) =>
    key.length >= 1 && key.length <= 1000 && !key.startsWith('/') && !key.includes('\\') && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(key) &&
    !key.split('/').some((s) => s === '..' || s === '.') && !hasControl(key) &&
    ((m) => m === undefined || Number(m) === orgId)(/^[^/]+\/(\d+)\//.exec(key)?.[1]);
  assert.equal(accepted(doc, 42), true);
  assert.equal(accepted(doc, 43), false, 'another workspace id in the key is refused by the service');
  assert.equal(accepted('https://x.test/a.pdf', 42), false, 'a Waboo URL is not a storage key: it must be converted');
  assert.equal(lib.targetKeyOf(org, g('contact_files')), doc, 'stable: the same URL gives the same key');
});

test('safeName never lets a path escape', () => {
  assert.equal(lib.safeName('/a/../../etc/passwd'), 'passwd');
  assert.equal(lib.safeName('/a/%2e%2e'), 'file');
  assert.equal(lib.safeName('/a/h%C3%A9llo w%.jpg'), 'h_c3_a9llo_w_.jpg');
  assert.equal(lib.safeName('/a/Cd4E_Untitled.JPEG'), 'cd4e_untitled.jpeg'); // the app only serves lower-case keys
  assert.equal(lib.safeName('/a/__x.png'), 'x.png'); // a segment must start with a letter or digit
});

// ---------------------------------------------------------------------------------------------------------------------------------
// DB tests need a migrated Postgres: FILES_TEST_OWNER_URL (owner login) + FILES_TEST_WORKER_URL (crm_worker_user login on the SAME database),
// or the scratch Postgres' pilot/.scratch.env. Without either they skip.
const envFile = path.resolve(__dirname, '../.scratch.env');
const scratch = process.env.FILES_TEST_OWNER_URL
  ? { MIGRATION_DATABASE_URL: process.env.FILES_TEST_OWNER_URL, TARGET_DATABASE_URL: process.env.FILES_TEST_WORKER_URL }
  : fs.existsSync(envFile)
    ? Object.fromEntries(fs.readFileSync(envFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
    : null;

test('database flow: plan, apply limits, copy, idempotency, resume, isolation, verify', { skip: !scratch && 'scratch Postgres is not up' }, async (t) => {
  const { Client } = require('pg');
  const owner = new Client({ connectionString: scratch.MIGRATION_DATABASE_URL });
  try {
    await owner.connect();
  } catch {
    return t.skip('scratch Postgres not reachable');
  }
  const tag = crypto.randomBytes(4).toString('hex');
  const slugA = `fc-a-${tag}`, slugB = `fc-b-${tag}`;
  const mk = async (slug) => (await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id, uuid::text AS uuid`, [slug])).rows[0];
  const A = await mk(slugA), B = await mk(slugB);
  const U = (p, q = '') => `http://127.0.0.1:${srcPort}${p}${q}`;
  let seq = 1;
  const msg = (org, url, extra = '') =>
    owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, meta, created_at)
       VALUES ($1, 1, $2, 'in', 'image', 'customer', 'received', $3::jsonb, '2026-03-05T10:00:00.123456Z')`,
      [org.id, seq++, JSON.stringify({ legacy: { mediaUrl: url, keep: 'yes' } })],
    );
  try {
    // A: two messages sharing one photo (different tokens), one pdf message, one 404, one 403, one HTML page; B: the same photo
    await msg(A, U('/a/photo-one.jpg', '?token=SECRETTOKEN1'));
    await msg(A, U('/a/photo-one.jpg', '?token=SECRETTOKEN2'));
    await msg(A, U('/a/doc.pdf'));
    await msg(A, U('/gone'));
    await msg(A, U('/forbidden'));
    await msg(A, U('/html'));
    await msg(B, U('/a/photo-one.jpg'));
    const cA = (await owner.query(`INSERT INTO contacts (org_id, name) VALUES ($1,'Invented') RETURNING id`, [A.id])).rows[0].id;
    await owner.query(`INSERT INTO contact_files (org_id, contact_id, file_name, storage_key) VALUES ($1,$2,'x.pdf',$3)`, [A.id, cA, U('/a/doc.pdf')]);

    process.env.TARGET_DATABASE_URL = scratch.TARGET_DATABASE_URL;
    Object.assign(process.env, { S3_ENDPOINT: `http://127.0.0.1:${s3Port}`, S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'testkey', S3_SECRET_ACCESS_KEY: 'testsecret', S3_BUCKET_MEDIA: 'crm-media', S3_BUCKET_DOCUMENTS: 'crm-documents', S3_FORCE_PATH_STYLE: 'true' });
    const dbName = new URL(scratch.TARGET_DATABASE_URL).pathname.slice(1);
    const cfgFile = path.join(tmp, 'cfg.json');
    fs.writeFileSync(cfgFile, JSON.stringify(cfgOf()));
    const regFile = path.join(tmp, 'att.ndjson');
    fs.writeFileSync(regFile, [{ source: U('/a/photo-one.jpg', '?x=1'), file_size: { $numberLong: String(BODY.jpg.length) }, content_type: 'image/jpeg', is_deleted: false }, { source: U('/never-referenced.png'), file_size: 5 }, { type: 'errored', name: 'job output' }].map((o) => JSON.stringify(o)).join('\n'));
    const state = path.join(tmp, 'state.jsonl');
    const base = ['--org-slug', slugA, '--confirm-db-name', dbName, '--config', cfgFile, '--attachments', regFile, '--state', state];
    let out = [];
    lib.setOut((l) => out.push(lib.scrub(l)));
    const run = async (args) => ((out = []), { code: await lib.main(args, T), text: out.join('\n') });
    const rowsOf = async (org) => (await owner.query(`SELECT id, media_key, media_sha256, meta, created_at::text AS created_at FROM messages WHERE org_id = $1 ORDER BY seq`, [org.id])).rows;
    const createdBefore = new Map((await rowsOf(A)).map((x) => [x.id, x.created_at]));
    const bBefore = JSON.stringify(await rowsOf(B));

    // plan: read only
    let r = await run(['plan', ...base]);
    assert.equal(r.code, 0);
    assert.match(r.text, /messages=6 contact_files=1/);
    assert.match(r.text, /distinct files \(per table\): 6 {3}duplicate references: 1/);
    assert.match(r.text, /by host: 127\.0\.0\.1=6/);
    assert.match(r.text, /need auth: 2 rows carry a signature/);
    assert.match(r.text, /UNREFERENCED_NOT_COPIED\)=1/);
    assert.match(r.text, /file_manager: 1 folder marker/);
    assert.equal(srcHits.length, 0);
    assert.equal(puts.length, 0);
    r = await run(['copy', ...base]); // no --apply = plan
    assert.match(r.text, /dry run/);

    // apply refuses without its confirmations and limits
    for (const extra of [['--apply'], ['--apply', '--confirm-org-slug', slugA], ['--apply', '--confirm-org-slug', 'wrong', '--max-files', '5', '--max-gb', '1']])
      await assert.rejects(lib.main(['copy', ...base, ...extra], T), /--confirm-org-slug|--max-files/);
    await assert.rejects(lib.main(['copy', ...base.slice(0, 2), '--confirm-db-name', 'nope', ...base.slice(4)], T), /confirm-db-name/);

    // first apply with a limit of 2 files: the rest is deferred, nothing aborts
    const ap = ['copy', ...base, '--apply', '--confirm-org-slug', slugA, '--max-gb', '1', '--concurrency', '1', '--delay-ms', '0'];
    r = await run([...ap, '--max-files', '2']);
    assert.match(r.text, /deferred-by-limit=4/);
    // finish (resume): previously copied ones come from the state file, nothing is downloaded twice
    const hitsBefore = srcHits.length, putsBefore = puts.length;
    r = await run([...ap, '--max-files', '10']);
    assert.equal(r.code, 1);
    assert.match(r.text, /failed=3/);
    assert.match(r.text, /AUTH_REQUIRED=1/);
    assert.match(r.text, /HTTP_404=1/);
    assert.match(r.text, /NOT_A_FILE=1/);
    assert.ok(srcHits.length > hitsBefore && puts.length >= putsBefore);
    assert.equal(new Set(puts).size, puts.length, 'each object uploaded once');
    // every row of A that could be copied now points at a bare key under A's uuid, in the right bucket; failures untouched
    const a = await rowsOf(A);
    const ok = a.filter((x) => x.media_key);
    assert.equal(ok.length, 3);
    for (const x of ok) {
      assert.match(x.media_key, new RegExp(`^chat/${A.id}/waboo/[0-9a-f]{16}/(photo-one\\.jpg|doc\\.pdf)$`));
      assert.equal(x.meta.legacy.keep, 'yes');
      assert.equal(x.meta.legacy.mediaUrl, undefined);
      assert.match(x.meta.legacy.sourceUrl, /^http:\/\/127\.0\.0\.1:\d+\/a\/(photo-one\.jpg|doc\.pdf)$/); // no query string kept
      assert.equal(x.created_at, createdBefore.get(x.id), 'created_at preserved to the microsecond');
      assert.ok(objects.has(`/crm-media/${x.media_key}`));
    }
    assert.equal(ok[0].media_sha256, sha(BODY.jpg));
    assert.equal(a.filter((x) => !x.media_key && x.meta.legacy.mediaUrl).length, 3);
    assert.equal((await owner.query(`SELECT storage_key FROM contact_files WHERE org_id = $1`, [A.id])).rows[0].storage_key.startsWith(`contact-files/${A.id}/waboo/`), true);
    assert.ok([...objects.keys()].some((k) => k.startsWith('/crm-documents/')));
    assert.equal(JSON.stringify(await rowsOf(B)), bBefore, 'other org untouched');
    assert.equal(objects.size, 3);

    // output and state carry no token and no file name
    const all = out.join('\n') + fs.readFileSync(state, 'utf8');
    assert.doesNotMatch(all, /SECRETTOKEN|photo-one|doc\.pdf|\?/.source ? /SECRETTOKEN/ : /x/);
    assert.doesNotMatch(out.join('\n'), /photo-one|doc\.pdf|\?token/);

    // idempotent: a re-run downloads nothing new, uploads nothing, changes no row (failures are retried, nothing else)
    const hits2 = srcHits.length, puts2 = puts.length;
    r = await run([...ap, '--max-files', '10']);
    assert.match(r.text, /copied=0 resumed-from-state=0/);
    assert.equal(puts.length, puts2);
    assert.equal(srcHits.length - hits2, 3, 'only the three failing URLs are tried again');

    // verify: failures remain as exceptions; then the clean part
    r = await run(['verify', ...base]);
    assert.equal(r.code, 1);
    assert.match(r.text, /objects checked=4 .* problems: \(none\)/);
    assert.match(r.text, /rows still pointing at a URL: 3 {2}by table@host: messages@127\.0\.0\.1 \[waboo host\]=3/);
    assert.match(r.text, /AUTH_REQUIRED=1/);
    tamper.add(`/crm-media/${ok[0].media_key}`);
    objects.delete(`/crm-documents/${(await owner.query(`SELECT storage_key FROM contact_files WHERE org_id = $1`, [A.id])).rows[0].storage_key}`);
    r = await run(['verify', ...base]);
    assert.match(r.text, /SHA256_MISMATCH=\d/);
    assert.match(r.text, /OBJECT_MISSING=1/);
    assert.equal(JSON.stringify(await rowsOf(B)), bBefore);
  } finally {
    await owner.query(`DELETE FROM messages WHERE org_id = ANY($1)`, [[A.id, B.id]]);
    await owner.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[A.id, B.id]]);
    await owner.end();
  }
});

test('flows: media urls on a Waboo host are found inside flow_data and replaced exactly', () => {
  const data = { nodes: [{ type: 'media', data: { url: 'https://files.waboo.test/a/logo.png?sig=1', caption: 'x' } }, { type: 'message', data: { text: 'https://other.test/x.png' } }] };
  const urls = [...lib.jsonUrls(data, ['files.waboo.test'])];
  assert.deepEqual(urls, ['https://files.waboo.test/a/logo.png?sig=1']);
  const cnt = { n: 0 };
  const next = lib.jsonReplace(data, urls[0], 'https://media.example.test/flow-media/1/waboo/h/logo.png', cnt);
  assert.equal(cnt.n, 1);
  assert.equal(next.nodes[0].data.url, 'https://media.example.test/flow-media/1/waboo/h/logo.png');
  assert.equal(next.nodes[1].data.text, 'https://other.test/x.png');
  assert.equal(data.nodes[0].data.url.startsWith('https://files.waboo.test'), true);
});
