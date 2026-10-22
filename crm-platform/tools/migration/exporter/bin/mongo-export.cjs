#!/usr/bin/env node
/**
 * Read-only exporter: Waboo MongoDB collections -> canonical Extended JSON, one document per line (<collection>.ndjson).
 *
 * The database only answers on the Geta network, so the export runs `mongosh` ON THE JUMP HOST over ssh and reads the documents from its
 * stdout. The connection string never appears in an argument list, a log or this program's output: the jump host gets it on stdin only,
 * and everything printed or logged is scrubbed of it. Nothing here writes to Mongo (find / countDocuments / getCollectionNames only).
 *
 *   node mongo-export.cjs --db <waboo database> --client <key> (--collections a,b | --registry-classes MIGRATE,MIGRATE_LATER)
 *        --out <dir> --i-confirm-encrypted-volume        local files under <dir>/<client>/
 *   node mongo-export.cjs ... --to-ssh --i-confirm-server-is-staging     stream to the staging server, nothing kept locally
 *
 *   --limit N               smoke export of N documents (recorded; a later full export re-exports)
 *   --force                 re-export even when the file and its record already match
 *   --tolerance N           accept a source count up to N documents above the exported number (a live collection moves)
 *   --max-gb G              stop (exit 5) when one collection passes G gigabytes
 *   --no-manifest           do not write manifest.json
 *   --remote-dir D          --to-ssh only; must be /opt/desk/migration/dumps or a folder below it
 *   --log-dir D             where the counts-only run log goes (default: <kit>/logs)
 *   --tool-dir D            the migration tool (its registry decides what is exported); default: the folder two levels up from the kit
 *   --i-know-what-i-am-doing --reason "<10+ chars>"    export a denylisted collection (never system.*)
 *
 * Environment: MONGO_EXPORT_ENV (file with JUMP_HOST, JUMP_USER, PEM_PATH, MONGO_URI; default <kit>/.env), SSH_BIN (default ssh),
 * STAGING_SERVER_ENV (file with SERVER_HOST, SERVER_USER, SSH_KEY [, SERVER_APP_DIR]) and STAGING_SSH_BIN (default ssh) for --to-ssh.
 *
 * Exit codes: 0 ok, 1 failure, 2 refused before anything ran, 3 count mismatch, 4 host key not trusted, 5 size limit.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const KIT = path.resolve(__dirname, '..');
const REMOTE_ROOT = '/opt/desk/migration/dumps';
/** Collections that hold bot credentials or auth events: refused unless overridden with a written reason. */
const DENYLIST = new Set(['chatbot_misc_config', 'auth_logs']);
const NAME_RE = /^[A-Za-z0-9_.-]{1,120}$/;
const CLIENT_RE = /^[a-z0-9_-]{1,64}$/;
/** Keys dropped from the documents of the user collection, on the jump host, before anything leaves it. */
const STRIP_COLLECTION_RE = /^users?$/;
const STRIP_KEY_SOURCE = '^(password|passwordhash|password_.*|.*_?password|.*token.*|.*secret.*|api_?key|apikey|.*_api_?key|access_?key|private_?key|credentials?)$';

class Fail extends Error {
  constructor(code, msg) {
    super(msg);
    this.code = code;
  }
}
const refuse = (msg) => {
  throw new Fail(2, msg);
};

// ---------- arguments ----------------------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const flags = new Set([
    '--to-ssh',
    '--i-confirm-server-is-staging',
    '--i-confirm-encrypted-volume',
    '--no-manifest',
    '--force',
    '--i-know-what-i-am-doing',
  ]);
  const vals = new Set([
    '--db',
    '--client',
    '--out',
    '--collections',
    '--registry-classes',
    '--limit',
    '--tolerance',
    '--max-gb',
    '--remote-dir',
    '--log-dir',
    '--tool-dir',
    '--reason',
  ]);
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (flags.has(k)) a[k] = true;
    else if (vals.has(k)) {
      if (i + 1 >= argv.length) refuse(`${k} needs a value`);
      a[k] = argv[++i];
    } else refuse(`unknown argument ${k}`);
  }
  return a;
}

function loadEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

// ---------- secrets never leave ------------------------------------------------------------------------------------------------------
let SECRETS = [];
function registerSecrets(uri) {
  const s = new Set([uri]);
  try {
    const u = new URL(uri);
    for (const v of [u.password, decodeURIComponent(u.password), u.username, u.host]) if (v && v.length >= 3) s.add(v);
  } catch {
    /* a connection string the URL parser rejects is still redacted whole */
  }
  SECRETS = [...s].sort((x, y) => y.length - x.length);
}
function scrub(text) {
  let t = String(text);
  for (const s of SECRETS) t = t.split(s).join('***');
  return t.replace(/mongodb(\+srv)?:\/\/[^\s'"]+/g, '***');
}

// ---------- output rules -------------------------------------------------------------------------------------------------------------
function checkOutDir(out) {
  if (/^\\\\|^\/\/[^/]/.test(out)) refuse('--out is a network path (UNC); a dump must stay on this machine');
  const abs = path.resolve(out);
  if (/(^|[\\/])(OneDrive[^\\/]*|Dropbox|Google Drive|iCloud[^\\/]*|Box)([\\/]|$)/i.test(abs))
    refuse('--out is inside a synced-cloud folder (OneDrive, Dropbox, Google Drive, iCloud, Box); a dump must not be uploaded by a sync client');
  for (let d = abs; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) refuse(`--out is inside a git repository (${d}); a dump must never be committed`);
    if (path.dirname(d) === d) break;
  }
  return abs;
}

function checkRemoteDir(d) {
  if (!/^[A-Za-z0-9_./-]+$/.test(d) || d.split('/').includes('..') || d.includes('//'))
    refuse(`--remote-dir ${JSON.stringify(d)} is not an allowed path`);
  if (d !== REMOTE_ROOT && !d.startsWith(REMOTE_ROOT + '/')) refuse(`--remote-dir must be ${REMOTE_ROOT} or a folder below it`);
  return d.replace(/\/$/, '');
}

// ---------- registry (read through the migration tool's own registry; no tsx needed) -----------------------------------------------------
function resolveDispositions(toolDir, names) {
  const reg = path.join(toolDir, 'registry', 'index.ts');
  if (!fs.existsSync(reg)) refuse(`the migration tool's registry ${reg} does not exist (use --tool-dir)`);
  const code =
    "import { pathToFileURL } from 'node:url';" +
    'const m = await import(pathToFileURL(process.argv[1]).href);' +
    "let raw = ''; process.stdin.setEncoding('utf8');" +
    "for await (const c of process.stdin) raw += c;" +
    'const o = {}; for (const n of JSON.parse(raw)) o[n] = m.resolve(n).disposition;' +
    "process.stdout.write(JSON.stringify(o) + '\\n');";
  const r = spawnSync(
    process.execPath,
    ['--no-warnings', '--experimental-strip-types', '--input-type=module', '-e', code, reg],
    { input: JSON.stringify(names), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (r.status !== 0) refuse(`could not read the registry (needs Node 22.18+ or --experimental-strip-types): ${scrub(r.stderr).slice(0, 300)}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// ---------- the jump host (source) -----------------------------------------------------------------------------------------------------
const q = (s) => JSON.stringify(s);
const mongoshPrefix = (uri, db) => `const conn = connect(${q(uri)}); const db = conn.getSiblingDB(${q(db)}); `;

function discoveryScript(uri, db) {
  return mongoshPrefix(uri, db) + `print("@@NAMES " + JSON.stringify(db.getCollectionNames()));\n`;
}

function collectionScript(uri, db, name, limit) {
  const strip = STRIP_COLLECTION_RE.test(name);
  const proj = strip ? '{"password":0}' : '{}';
  return (
    mongoshPrefix(uri, db) +
    `const NAME = ${q(name)}; ` +
    `if (!db.getCollectionNames().includes(NAME)) { print("@@MISSING"); } else { ` +
    `const coll = db.getCollection(NAME); ` +
    `print("@@COUNT " + coll.countDocuments()); ` +
    `const STRIP = ${strip ? 'true' : 'false'}; const KEYRE = new RegExp(${q(STRIP_KEY_SOURCE)}, "i"); let stripped = 0; ` +
    `const clean = function (v) { if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) clean(v[i]); return; } ` +
    `if (v === null || typeof v !== "object") return; ` +
    `for (const k of Object.keys(v)) { if (k.charAt(0) !== "$" && KEYRE.test(k)) { delete v[k]; stripped++; } else clean(v[k]); } }; ` +
    `const cur = coll.find({}, ${proj}).sort({ _id: 1 })${limit > 0 ? `.limit(${Number(limit)})` : ''}; ` +
    `let n = 0; ` +
    `while (cur.hasNext()) { const o = JSON.parse(EJSON.stringify(cur.next(), { relaxed: false })); if (STRIP) clean(o); print("@@D " + JSON.stringify(o)); n++; } ` +
    `print("@@STRIP " + stripped); print("@@END " + n); }\n`
  );
}

const HOSTKEY_RE = /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/;
function hostKeyFail(stderr) {
  return new Fail(
    4,
    `${(stderr.match(HOSTKEY_RE) || ['Host key verification failed.'])[0].replace(/\.?$/, '.')}\n` +
      'The jump host key is not the one on record. Do NOT bypass this (no StrictHostKeyChecking=no, no deleting known_hosts blindly): ' +
      'confirm the fingerprint with the owner of the jump host, then fix known_hosts deliberately.',
  );
}

/** Starts the source ssh and feeds it the mongosh script. */
function spawnSource(cfg, script) {
  const argv = [
    '-i',
    cfg.pem,
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'BatchMode=yes',
    '-o',
    'ServerAliveInterval=30',
    `${cfg.jumpUser}@${cfg.jumpHost}`,
    'mongosh --nodb --quiet',
  ];
  const c = spawn(cfg.sshBin, argv, { stdio: ['pipe', 'pipe', 'pipe'] });
  c.stdin.on('error', () => {});
  c.stdin.end(script);
  return c;
}

/**
 * A line of mongosh output -> the part that starts at its @@ marker, or null for noise. Piped into mongosh, the first printed line comes
 * after a prompt ("> @@COUNT 5", "rs0 [direct: secondary] db> @@COUNT 5"); the later ones start at the marker.
 */
function markerOf(l) {
  if (l.length >= 3 && l[0] === 0x40 && l[1] === 0x40) return l;
  const i = l.subarray(0, 300).indexOf('> @@');
  return i >= 0 ? l.subarray(i + 2) : null;
}

/** Splits a byte stream into lines without cutting a multibyte character: the buffer is cut at 0x0a only. */
function lineSplitter(onLine) {
  let buf = Buffer.alloc(0);
  return {
    push(chunk) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      let i;
      while ((i = buf.indexOf(0x0a)) >= 0) {
        let line = buf.subarray(0, i);
        if (line.length && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1);
        buf = buf.subarray(i + 1);
        if (onLine(line) === false) return false;
      }
      return true;
    },
    /** bytes of an unterminated last line */
    rest: () => buf.length,
  };
}

async function discover(cfg, db) {
  const c = spawnSource(cfg, discoveryScript(cfg.uri, db));
  let names = null;
  const err = [];
  const split = lineSplitter((raw) => {
    const l = markerOf(raw);
    if (!l) return;
    const s = l.toString('utf8');
    if (s.startsWith('@@NAMES ')) names = JSON.parse(s.slice(8));
  });
  c.stdout.on('data', (d) => split.push(d));
  c.stderr.on('data', (d) => err.push(d));
  const code = await new Promise((res) => c.on('close', res));
  const stderr = scrub(Buffer.concat(err).toString('utf8'));
  if (HOSTKEY_RE.test(stderr)) throw hostKeyFail(stderr);
  if (code !== 0 || !Array.isArray(names)) throw new Fail(1, `could not list the collections (ssh exit ${code}): ${stderr.trim().slice(0, 400)}`);
  return names;
}

// ---------- sinks (where the bytes go) -----------------------------------------------------------------------------------------------
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function localSink(dir) {
  return {
    where: 'local',
    async prepare() {
      fs.mkdirSync(path.join(dir, '.export'), { recursive: true, mode: 0o700 });
    },
    async existing(name) {
      const f = path.join(dir, `${name}.ndjson`);
      const r = path.join(dir, '.export', `${name}.json`);
      if (!fs.existsSync(f) || !fs.existsSync(r)) return null;
      try {
        const sha = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
        return { record: JSON.parse(fs.readFileSync(r, 'utf8')), sha256: sha };
      } catch {
        return null;
      }
    },
    open(name) {
      const part = path.join(dir, `${name}.ndjson.part`);
      const fd = fs.openSync(part, 'w', 0o600);
      return {
        async write(buf) {
          fs.writeSync(fd, buf);
        },
        async finish() {
          fs.closeSync(fd);
          fs.renameSync(part, path.join(dir, `${name}.ndjson`));
        },
        async abort() {
          try {
            fs.closeSync(fd);
          } catch {
            /* already closed */
          }
          fs.rmSync(part, { force: true });
        },
      };
    },
    async writeRecord(name, rec) {
      fs.writeFileSync(path.join(dir, '.export', `${name}.json`), JSON.stringify(rec, null, 2) + '\n', { mode: 0o600 });
    },
    async removeFinal(name) {
      fs.rmSync(path.join(dir, `${name}.ndjson`), { force: true });
    },
    async writeManifest(m) {
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n', { mode: 0o600 });
    },
    async writeLog(name, text) {
      fs.writeFileSync(path.join(dir, '.export', `${name}.log`), scrub(text), { mode: 0o600 });
    },
  };
}

function sshSink(cfg, remoteDir, client) {
  const dir = `${remoteDir}/${client}`;
  const base = [
    '-i',
    cfg.serverKey,
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'BatchMode=yes',
    '-o',
    'ServerAliveInterval=30',
    `${cfg.serverUser}@${cfg.serverHost}`,
  ];
  const run = (cmd, input) =>
    new Promise((res) => {
      const c = spawn(cfg.stagingSshBin, [...base, cmd], { stdio: ['pipe', 'pipe', 'pipe'] });
      const out = [];
      const err = [];
      c.stdout.on('data', (d) => out.push(d));
      c.stderr.on('data', (d) => err.push(d));
      c.stdin.on('error', () => {});
      c.stdin.end(input === undefined ? undefined : input);
      c.on('close', (code) => res({ code: code === null ? 255 : code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }));
    });
  const put = async (rel, text) => {
    const r = await run(`umask 077; cat > ${shq(`${dir}/${rel}`)} && chown 10001:10001 ${shq(`${dir}/${rel}`)}`, text);
    if (r.code !== 0) throw new Fail(1, `could not write ${rel} on the server (ssh exit ${r.code})`);
  };
  return {
    where: 'staging server',
    async prepare() {
      const r = await run(`umask 077; mkdir -p ${shq(dir)} ${shq(dir + '/.export')} && chown 10001:10001 ${shq(dir)} ${shq(dir + '/.export')}`);
      if (r.code !== 0) throw new Fail(1, `could not create ${dir} on the server (ssh exit ${r.code}): ${scrub(r.stderr).slice(0, 300)}`);
    },
    async existing(name) {
      const r = await run(
        `cd ${shq(dir)} 2>/dev/null && [ -f ${shq(name + '.ndjson')} ] && [ -f ${shq('.export/' + name + '.json')} ] && ` +
          `cat ${shq('.export/' + name + '.json')} && echo && echo @@SHA && sha256sum ${shq(name + '.ndjson')}; true`,
      );
      const i = r.stdout.indexOf('@@SHA\n');
      if (i < 0) return null;
      try {
        return { record: JSON.parse(r.stdout.slice(0, i)), sha256: r.stdout.slice(i + 6).trim().split(/\s+/)[0] };
      } catch {
        return null;
      }
    },
    open(name) {
      const part = `${dir}/${name}.ndjson.part`;
      const c = spawn(cfg.stagingSshBin, [...base, `umask 077; cat > ${shq(part)}`], { stdio: ['pipe', 'ignore', 'pipe'] });
      const err = [];
      c.stderr.on('data', (d) => err.push(d));
      let dead = null;
      c.stdin.on('error', (e) => {
        dead = e;
      });
      const closed = new Promise((res) => c.on('close', (code) => res(code === null ? 255 : code)));
      closed.then((code) => {
        if (code !== 0 && !dead) dead = new Error(`ssh exit ${code}`);
      });
      const bytes = { n: 0 };
      const sha = crypto.createHash('sha256');
      return {
        async write(buf) {
          if (dead) throw new Fail(1, `the staging server ssh died during the stream (${dead.message})`);
          bytes.n += buf.length;
          sha.update(buf);
          if (!c.stdin.write(buf)) {
            await new Promise((res) => {
              const done = () => {
                c.stdin.off('drain', done);
                c.off('close', done);
                res();
              };
              c.stdin.once('drain', done);
              c.once('close', done);
            });
            if (dead) throw new Fail(1, `the staging server ssh died during the stream (${dead.message})`);
          }
        },
        async finish() {
          c.stdin.end();
          const code = await closed;
          if (code !== 0) throw new Fail(1, `the staging server ssh ended with exit ${code} (${scrub(Buffer.concat(err).toString('utf8')).trim().slice(0, 200)})`);
          const v = await run(`cd ${shq(dir)} && sha256sum ${shq(name + '.ndjson.part')} && stat -c %s ${shq(name + '.ndjson.part')}`);
          const [line, size] = v.stdout.trim().split('\n');
          const serverSha = (line || '').split(/\s+/)[0];
          if (v.code !== 0 || serverSha !== sha.digest('hex') || Number(size) !== bytes.n) {
            await run(`rm -f ${shq(part)}`);
            throw new Fail(1, `${name}: the server holds different bytes than were sent (sha256 or size differ); the .part was removed`);
          }
          const m = await run(`mv -f ${shq(part)} ${shq(`${dir}/${name}.ndjson`)} && chown 10001:10001 ${shq(`${dir}/${name}.ndjson`)}`);
          if (m.code !== 0) throw new Fail(1, `${name}: could not finalize the file on the server`);
        },
        async abort() {
          try {
            c.stdin.destroy();
            c.kill();
          } catch {
            /* gone */
          }
          await run(`rm -f ${shq(part)}`);
        },
      };
    },
    async writeRecord(name, rec) {
      await put(`.export/${name}.json`, JSON.stringify(rec, null, 2) + '\n');
    },
    async removeFinal(name) {
      await run(`rm -f ${shq(`${dir}/${name}.ndjson`)}`);
    },
    async writeManifest(m) {
      await put('manifest.json', JSON.stringify(m, null, 2) + '\n');
    },
    async writeLog() {
      /* nothing is kept on the server beside the data and its records */
    },
  };
}

// ---------- one collection -----------------------------------------------------------------------------------------------------------
async function exportCollection(cfg, sink, name, o) {
  const limit = o.limit > 0 ? o.limit : null;
  if (!o.force) {
    const ex = await sink.existing(name);
    if (ex && ex.record && ex.record.sha256 === ex.sha256 && (ex.record.limit ?? null) === limit) {
      console.log(`${name}: skipped (already exported: ${ex.record.docs} documents, matches its record)`);
      return { collection: name, docs: ex.record.docs, badLines: ex.record.badLines || 0, bytes: ex.record.bytes, sha256: ex.record.sha256 };
    }
  }
  const source = spawnSource(cfg, collectionScript(cfg.uri, cfg.db, name, limit || 0));
  const out = sink.open(name);
  const maxBytes = o.maxGb > 0 ? o.maxGb * 1024 ** 3 : Infinity;
  const stderrChunks = [];
  source.stderr.on('data', (d) => {
    stderrChunks.push(d);
    for (const l of scrub(d.toString('utf8')).split('\n')) if (l.trim()) console.error(`  [${name}] ${l.trim().slice(0, 300)}`);
  });

  const st = { count: null, end: null, strip: 0, docs: 0, bytes: 0, missing: false, bad: 0, fail: null };
  const hash = crypto.createHash('sha256');
  let chain = Promise.resolve();
  const split = lineSplitter((raw) => {
    const l = markerOf(raw);
    if (!l) return; // mongosh noise (log id, version banner, prompt, "...")
    const s = l.toString('utf8');
    if (s.startsWith('@@D ')) {
      const json = l.subarray(4);
      try {
        const v = JSON.parse(json.toString('utf8'));
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
      } catch {
        st.bad++;
        st.fail = st.fail || new Fail(1, `${name}: a document line is not valid JSON (line ${st.docs + 1}); nothing was kept`);
        return false;
      }
      const buf = Buffer.concat([json, Buffer.from('\n')]);
      st.docs++;
      st.bytes += buf.length;
      hash.update(buf);
      if (st.bytes > maxBytes) {
        st.fail = new Fail(5, `${name}: passed the --max-gb limit (${o.maxGb} GB); nothing was kept`);
        return false;
      }
      chain = chain.then(() => out.write(buf)).catch((e) => {
        st.fail = st.fail || e;
      });
    } else if (s.startsWith('@@COUNT ')) st.count = Number(s.slice(8));
    else if (s.startsWith('@@STRIP ')) st.strip = Number(s.slice(8)) || 0;
    else if (s.startsWith('@@END ')) st.end = Number(s.slice(6));
    else if (s === '@@MISSING') st.missing = true;
  });
  const exited = new Promise((res) => source.on('close', (c) => res(c === null ? 255 : c)));
  // read sequentially: each chunk is written to the sink before the next one is taken (backpressure for free)
  for await (const d of source.stdout) {
    if (split.push(d) === false || st.fail) {
      source.kill();
      break;
    }
    await chain;
    if (st.fail) {
      source.kill();
      break;
    }
  }
  const code = await exited;
  await chain;
  const stderr = scrub(Buffer.concat(stderrChunks).toString('utf8'));

  const abort = async (e) => {
    await out.abort();
    throw e;
  };
  if (st.fail) await abort(st.fail);
  if (HOSTKEY_RE.test(stderr)) await abort(hostKeyFail(stderr));
  if (st.missing) {
    await out.abort();
    console.log(`${name}: not present in ${cfg.dbLabel}; nothing exported`);
    return null;
  }
  if (code !== 0) await abort(new Fail(1, `${name}: the source ssh/mongosh ended with exit ${code}; nothing was kept`));
  if (st.end === null) await abort(new Fail(1, `${name}: the stream ended before its end marker (truncated); nothing was kept`));
  if (st.end !== st.docs) await abort(new Fail(1, `${name}: the source says it sent ${st.end} documents, ${st.docs} arrived; nothing was kept`));

  if (st.count !== null && !limit) {
    if (st.count !== st.docs) {
      if (st.count - st.docs >= 0 && st.count - st.docs <= o.tolerance) console.log(`${name}: count ${st.docs} vs source ${st.count}: within tolerance (${o.tolerance})`);
      else {
        await out.abort();
        console.log(`${name}: COUNT MISMATCH: wrote ${st.docs}, source countDocuments() says ${st.count}`);
        throw new Fail(3, `${name}: count mismatch; nothing was kept`);
      }
    }
  }
  try {
    await out.finish();
  } catch (e) {
    await out.abort();
    throw e;
  }
  const sha256 = hash.digest('hex');
  const rec = {
    collection: name,
    docs: st.docs,
    badLines: 0,
    bytes: st.bytes,
    sha256,
    limit,
    sourceCount: st.count,
    strippedKeys: st.strip,
    exportedAt: new Date().toISOString(),
  };
  await sink.writeRecord(name, rec);
  await sink.writeLog(name, `${name}: ${st.docs} documents, ${st.bytes} bytes, sha256 ${sha256}, source count ${st.count}, stripped keys ${st.strip}\n`);
  console.log(`${name}: ${st.docs} documents, ${st.bytes} bytes${limit ? ` (smoke export, --limit ${limit})` : ''}${st.strip ? `, ${st.strip} credential keys stripped` : ''}`);
  return { collection: name, docs: st.docs, badLines: 0, bytes: st.bytes, sha256 };
}

// ---------- main ---------------------------------------------------------------------------------------------------------------------
async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a['--db']) refuse('--db <waboo database> is required');
  if (!/^[A-Za-z0-9_+.-]{1,128}$/.test(a['--db'])) refuse('--db is not a valid database name');
  if (!a['--client'] || !CLIENT_RE.test(a['--client'])) refuse('--client <key> is required (a-z, 0-9, _ or -)');
  if (!a['--collections'] === !a['--registry-classes']) refuse('give exactly one of --collections and --registry-classes');
  const toSsh = !!a['--to-ssh'];
  const limit = a['--limit'] === undefined ? 0 : Number(a['--limit']);
  if (!Number.isInteger(limit) || limit < 0) refuse('--limit must be a whole number');
  const tolerance = a['--tolerance'] === undefined ? 0 : Number(a['--tolerance']);
  if (!Number.isInteger(tolerance) || tolerance < 0) refuse('--tolerance must be a whole number');
  const maxGb = a['--max-gb'] === undefined ? 0 : Number(a['--max-gb']);
  if (!(maxGb >= 0)) refuse('--max-gb must be a number');

  let outDir = null;
  let remoteDir = null;
  if (toSsh) {
    if (!a['--i-confirm-server-is-staging']) refuse('--to-ssh needs --i-confirm-server-is-staging (this host must be the staging server, never production)');
    if (a['--out']) refuse('--out cannot be combined with --to-ssh: nothing is kept on this machine');
    remoteDir = checkRemoteDir(a['--remote-dir'] || REMOTE_ROOT);
  } else {
    if (a['--remote-dir']) refuse('--remote-dir needs --to-ssh');
    if (!a['--out']) refuse('--out <dir> is required');
    outDir = checkOutDir(a['--out']);
    if (!a['--i-confirm-encrypted-volume']) refuse('the dump holds customer data: pass --i-confirm-encrypted-volume to confirm --out is on an ENCRYPTED volume');
  }

  const toolDir = path.resolve(a['--tool-dir'] || path.join(KIT, '..'));
  const override = !!a['--i-know-what-i-am-doing'];
  if (override && (a['--reason'] || '').trim().length < 10) refuse('--i-know-what-i-am-doing needs --reason "<why, at least 10 characters>"');

  // explicit collections: validated and checked against the denylist and the registry before any ssh call
  let explicit = null;
  if (a['--collections']) {
    explicit = a['--collections'].split(',').map((s) => s.trim()).filter(Boolean);
    if (!explicit.length) refuse('--collections is empty');
    for (const c of explicit) {
      if (!NAME_RE.test(c)) refuse(`${JSON.stringify(c)} is not a valid collection name`);
      if (c.startsWith('system.')) refuse(`${c}: system collections are never exported`);
    }
    const disp = resolveDispositions(toolDir, explicit);
    for (const c of explicit) {
      const denied = DENYLIST.has(c) || disp[c] === 'EXCLUDE';
      if (denied && !override) refuse(`${c} is on the denylist (${DENYLIST.has(c) ? 'bot credentials / auth events' : 'the registry says EXCLUDE'}); not exported. Override needs --i-know-what-i-am-doing --reason "..."`);
      if (denied) console.error(`OVERRIDE: exporting ${c} although it is denylisted. Reason: ${a['--reason']}`);
    }
  }
  const classes = a['--registry-classes'] ? a['--registry-classes'].split(',').map((s) => s.trim()).filter(Boolean) : null;
  if (classes && !classes.every((c) => ['MIGRATE', 'MIGRATE_LATER', 'GAP', 'OPEN'].includes(c))) refuse('--registry-classes takes MIGRATE, MIGRATE_LATER, GAP or OPEN');

  // configuration
  const envFile = process.env.MONGO_EXPORT_ENV || path.join(KIT, '.env');
  if (!fs.existsSync(envFile)) refuse(`the exporter's environment file ${envFile} does not exist (JUMP_HOST, JUMP_USER, PEM_PATH, MONGO_URI; see the kit README)`);
  const env = loadEnvFile(envFile);
  for (const k of ['JUMP_HOST', 'JUMP_USER', 'PEM_PATH', 'MONGO_URI']) if (!env[k]) refuse(`${envFile} is missing ${k}`);
  registerSecrets(env.MONGO_URI);
  const cfg = {
    jumpHost: env.JUMP_HOST,
    jumpUser: env.JUMP_USER,
    pem: path.resolve(path.dirname(envFile), env.PEM_PATH),
    uri: env.MONGO_URI,
    db: a['--db'],
    dbLabel: 'the Waboo database',
    sshBin: process.env.SSH_BIN || 'ssh',
    stagingSshBin: process.env.STAGING_SSH_BIN || 'ssh',
  };
  if (toSsh) {
    const f = process.env.STAGING_SERVER_ENV;
    if (!f || !fs.existsSync(f)) refuse('STAGING_SERVER_ENV must point to the staging server.env (SERVER_HOST, SERVER_USER, SSH_KEY)');
    const s = loadEnvFile(f);
    for (const k of ['SERVER_HOST', 'SERVER_USER', 'SSH_KEY']) if (!s[k]) refuse(`${f} is missing ${k}`);
    cfg.serverHost = s.SERVER_HOST;
    cfg.serverUser = s.SERVER_USER;
    cfg.serverKey = path.resolve(path.dirname(f), s.SSH_KEY);
  }

  const client = a['--client'];
  const logDir = path.resolve(a['--log-dir'] || path.join(KIT, 'logs'));
  const logLines = [];
  const log = (s) => logLines.push(`${new Date().toISOString()} ${s}`);
  const flushLog = () => {
    try {
      fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(logDir, `export-${client}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`), scrub(logLines.join('\n') + '\n'), { mode: 0o600 });
    } catch {
      /* a log that cannot be written must not hide the export's own result */
    }
  };

  let names = explicit;
  if (classes) {
    const all = await discover(cfg, cfg.db);
    const usable = all.filter((n) => NAME_RE.test(n) && !n.startsWith('system.'));
    const disp = resolveDispositions(toolDir, usable);
    names = [];
    for (const n of usable.sort()) {
      if (DENYLIST.has(n)) console.error(`skipped ${n} (denylist)`);
      else if (classes.includes(disp[n])) names.push(n);
      else console.error(`skipped ${n} (${disp[n]})`);
    }
    if (!names.length) throw new Fail(1, 'no collection of the requested classes exists in this database');
  }
  log(`export client=${client} to=${toSsh ? 'staging' : 'local'} collections=${names.length}`);

  const sink = toSsh ? sshSink(cfg, remoteDir, client) : localSink(path.join(outDir, client));
  const entries = [];
  try {
    await sink.prepare();
    for (const n of names) {
      const e = await exportCollection(cfg, sink, n, { limit, force: !!a['--force'], tolerance, maxGb });
      if (e) {
        entries.push(e);
        log(`${n}: ${e.docs} documents, ${e.bytes} bytes`);
      } else log(`${n}: not present`);
    }
    if (!a['--no-manifest'] && entries.length) {
      await sink.writeManifest({
        client,
        generatedAt: new Date().toISOString(),
        collections: entries.map((e) => ({ collection: e.collection, docs: e.docs, badLines: e.badLines, bytes: e.bytes, sha256: e.sha256 })),
      });
      console.log(`${client}: ${entries.length} collections, ${entries.reduce((s, e) => s + e.docs, 0)} documents -> manifest.json`);
    }
    log('done');
  } catch (e) {
    log(`failed: ${e.message}`);
    flushLog();
    throw e;
  }
  flushLog();
}

main().then(
  () => process.exit(0),
  (e) => {
    const code = e instanceof Fail ? e.code : 1;
    console.error(scrub(e instanceof Fail ? e.message : `unexpected error: ${e && e.stack ? e.stack : e}`));
    process.exit(code);
  },
);
