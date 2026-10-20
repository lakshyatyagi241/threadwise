import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Static scanners behind the cache-audit ratchets (Sheet3 #64). They read source text only: no Nest, no Redis, no database, so
 * the checks stay fast and run on every `pnpm test`. A scanner finds *candidates*; register.json decides what each one is.
 */
export const API_ROOT = resolve(__dirname, '../../..');
export const REPO_ROOT = resolve(API_ROOT, '../..');
export const API_SRC = join(API_ROOT, 'src');
export const WEB_SRC = join(REPO_ROOT, 'apps/web/src');

export function walk(dir: string, exts: RegExp = /\.tsx?$/, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!/^(node_modules|dist|\.next|\.turbo)$/.test(e.name)) walk(p, exts, out);
    } else if (exts.test(e.name) && !/\.(spec|test)\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

export const rel = (file: string): string => relative(REPO_ROOT, file).split('\\').join('/');

const parse = (file: string, text: string) =>
  ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

export interface CollectionHit {
  file: string;
  name: string;
  where: 'class' | 'module';
  ctor: 'Map' | 'Set';
  /** True when the file compares `<name>.size` (or a `store.size` passed in by a helper) with a limit: how this code caps a collection. */
  sizeCapped: boolean;
  /** True when the file removes entries by name (`delete`/`clear`) at all. */
  evicts: boolean;
}

/**
 * Mutable `Map`/`Set` fields: a class property or a module-level variable initialised with an empty `new Map()`/`new Set()`.
 * A collection filled from a literal array is a constant table, not a cache. `WeakMap` is bounded by the garbage collector.
 */
export function scanCollections(root: string = API_SRC): CollectionHit[] {
  const hits: CollectionHit[] = [];
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8');
    if (!/new (Map|Set)\b/.test(text)) continue;
    const sf = parse(file, text);
    const emptyNew = (init: ts.Expression | undefined): 'Map' | 'Set' | null => {
      if (!init) return null;
      let e = init;
      while (ts.isAsExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
      if (!ts.isNewExpression(e) || !ts.isIdentifier(e.expression)) return null;
      const n = e.expression.text;
      if ((n !== 'Map' && n !== 'Set') || (e.arguments && e.arguments.length > 0)) return null;
      return n;
    };
    const add = (name: string, where: 'class' | 'module', ctor: 'Map' | 'Set') => {
      const w = name.replace(/\$/g, '\\$');
      const direct = new RegExp(`\\b${w}\\.size\\s*(>=|>|<=|<|===|!==)`).test(text);
      const viaHelper =
        (/\bstore\.size\s*>=/.test(text) &&
          new RegExp(`remember\\(\\s*this\\.${w}\\b`).test(text)) ||
        new RegExp(`setCapped\\(\\s*this\\.${w}\\b`).test(text);
      hits.push({
        file: rel(file),
        name,
        where,
        ctor,
        sizeCapped: direct || viaHelper,
        evicts: new RegExp(`\\b${w}\\.(delete|clear)\\(`).test(text),
      });
    };
    (function visit(n: ts.Node) {
      if (ts.isPropertyDeclaration(n) && ts.isIdentifier(n.name)) {
        const c = emptyNew(n.initializer);
        if (c) add(n.name.text, 'class', c);
      } else if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        ts.isSourceFile(n.parent.parent.parent)
      ) {
        const c = emptyNew(n.initializer);
        if (c) add(n.name.text, 'module', c);
      }
      ts.forEachChild(n, visit);
    })(sf);
  }
  return hits;
}

export interface RedisCall {
  file: string;
  line: number;
  method: string;
  receiver: string;
  args: string[];
  /** Methods chained in front of this call (`multi().incr(k)`). */
  chain: string[];
  /** Methods chained after this call (`.incr(k).expire(k, 60, 'NX')`). */
  after: string[];
  /** The text of the enclosing function, to look for a paired `expire`. */
  scope: string;
}

const WRITE_METHODS = new Set([
  'set',
  'setex',
  'psetex',
  'setnx',
  'getset',
  'append',
  'mset',
  'incr',
  'incrby',
  'incrbyfloat',
  'decr',
  'hset',
  'hmset',
  'hincrby',
  'sadd',
  'zadd',
  'rpush',
  'lpush',
  'eval',
  'evalsha',
]);
const REDIS_RECEIVER = /(^|\.)(redis|client|conn|connection)$|redisClient|^(pub|sub)$/i;

/** Every ioredis write call in the API, found from the syntax tree. `Map#set` and header setters are told apart by the receiver name. */
export function scanRedisWrites(root: string = API_SRC): RedisCall[] {
  const out: RedisCall[] = [];
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8');
    if (!/redis/i.test(text)) continue;
    const sf = parse(file, text);
    const enclosing = (n: ts.Node): ts.Node => {
      let p: ts.Node | undefined = n.parent;
      while (p && !ts.isFunctionLike(p) && !ts.isSourceFile(p)) p = p.parent;
      return p ?? sf;
    };
    (function visit(n: ts.Node) {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const method = n.expression.name.text;
        let cur: ts.Expression = n.expression.expression;
        const chain: string[] = [];
        // multi().incr(k).expire(...): walk down to the first receiver and note the methods on the way.
        while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
          chain.push(cur.expression.name.text);
          cur = cur.expression.expression;
        }
        const after: string[] = [];
        let up: ts.Node = n;
        while (
          up.parent &&
          ts.isPropertyAccessExpression(up.parent) &&
          up.parent.parent &&
          ts.isCallExpression(up.parent.parent)
        ) {
          after.push(up.parent.name.text);
          up = up.parent.parent;
        }
        const recvText = cur.getText().replace(/\s+/g, '');
        if (WRITE_METHODS.has(method) && REDIS_RECEIVER.test(recvText)) {
          out.push({
            file: rel(file),
            line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
            method,
            receiver: recvText,
            args: n.arguments.map((a) => a.getText().replace(/\s+/g, ' ')),
            chain,
            after,
            scope: enclosing(n).getText(),
          });
        }
      }
      ts.forEachChild(n, visit);
    })(sf);
  }
  return out;
}

/** True when the call stores a value with an expiry: SET ... EX/PX/EXAT/KEEPTTL, or SETEX/PSETEX. */
export function setHasTtl(c: RedisCall): boolean {
  if (c.method === 'setex' || c.method === 'psetex') return true;
  if (c.method === 'set') return c.args.some((a) => /^'(EX|PX|EXAT|PXAT|KEEPTTL)'$/i.test(a));
  return false;
}

/** Counters and hashes: covered when the same pipeline, or the same function, also sets an expiry. */
export function counterHasTtl(c: RedisCall): boolean {
  return (
    c.chain.concat(c.after).some((m) => /^p?expire$/i.test(m)) ||
    /\.(p?expire)\(|\bEXPIRE\b/i.test(c.scope.slice(c.scope.indexOf(c.method)))
  );
}
