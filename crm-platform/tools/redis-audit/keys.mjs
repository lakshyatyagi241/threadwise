// Resolves the key argument of a Redis call to a key TEMPLATE (`auth:gate:${email}` -> `auth:gate:*`), by textual lookup.
// Honest limits: it follows (1) a literal, (2) a local `const key = <template>`, (3) a named builder (`AuthKeys.epoch`, `this.key(...)`,
// `govKeys.cfg(...)`) defined as an arrow function, method or constant, looked up in the same file first and then in the one other file
// that defines that name, and (4) `${CONST}` where CONST is a string constant. Anything else is `unresolved` and is listed as such in the
// inventory, never guessed. A name defined in several files is ambiguous and is not followed.
import { closeParen, splitArgs } from './scan.mjs';

const LIT = /^(?:`(?:\\.|[^`\\])*`|'[^'\n]*'|"[^"\n]*")/s;
const TPL = /^\s*([`'"])((?:\\.|(?!\1)[^\\])*)\1/s;

/** Interpolated expressions of a template literal, e.g. ['orgId', 'userId'], to decide tenant scoping. */
export function interpolations(literal) {
  const m = TPL.exec(literal);
  if (!m) return [];
  return [...m[2].matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1].trim());
}

/** Per-file and global maps of `name -> literal` for builders and string constants. */
export function buildIndex(files) {
  const byFile = new Map();
  const global = new Map();
  for (const f of files) {
    const local = new Map();
    const s = f.src;
    const put = (name, lit) => {
      if (!lit || local.has(name)) return;
      local.set(name, lit);
      global.set(name, global.has(name) && global.get(name)?.file !== f.path ? null : { file: f.path, lit });
    };
    // name: (args) => `tpl`  |  name = (args) => `tpl`
    for (const m of s.matchAll(/\b(\w+)\s*[:=]\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[\w<>[\]| ]+)?\s*=>\s*(?:\(\s*)?(?=[`'"])/g))
      put(m[1], s.slice(m.index + m[0].length).match(LIT)?.[0]);
    // name(args) { return `tpl` }  |  function name(args) { return `tpl` }
    for (const m of s.matchAll(/\b(\w+)\s*\([^)]*\)\s*(?::\s*[\w<>[\]| ]+)?\s*\{\s*return\s+(?=[`'"])/g))
      put(m[1], s.slice(m.index + m[0].length).match(LIT)?.[0]);
    // name: 'literal'  |  const NAME = 'literal'
    for (const m of s.matchAll(/\b(\w+)\s*(?::|=)\s*(?=['"`])/g)) put(m[1], s.slice(m.index + m[0].length).match(LIT)?.[0]);
    byFile.set(f.path, local);
  }
  return { byFile, global };
}

function lookup(name, file, index) {
  const own = index.byFile.get(file)?.get(name);
  if (own) return own;
  return index.global.get(name)?.lit ?? null;
}

/** `a:${x}:b` -> `a:*:b`; `${PREFIX}:x` with PREFIX a known string constant -> its value. */
function render(literal, file, index, depth = 0) {
  const m = TPL.exec(literal);
  if (!m) return null;
  const s = m[2];
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let d = 0;
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === '{') d++;
        else if (s[j] === '}' && --d === 0) break;
      }
      const inner = s.slice(i + 2, j).trim();
      const known = depth < 3 && /^[A-Z][A-Z0-9_]+$/.test(inner) ? lookup(inner, file, index) : null;
      const sub = known ? render(known, file, index, depth + 1) : null;
      out += sub !== null && !sub.includes('*') ? sub : '*';
      i = j;
    } else out += s[i];
  }
  return out;
}

/** `a:${x}:b` literal text (with its quotes) -> `a:*:b`. */
export function normalize(literal, file, index) {
  return render(literal, file, index);
}

/** Template for the key expression `expr` used at `line` of file `file`, or null. */
export function resolveKey(expr, src, line, index, file) {
  if (!expr) return null;
  const e = expr.trim();
  const viaLit = (lit) => {
    const t = lit ? render(lit, file, index) : null;
    return t === null ? null : { template: t, literal: lit };
  };
  if (TPL.test(e)) return viaLit(e.match(LIT)?.[0] ?? e);
  const id = /^(?:this\.)?(\w+)$/.exec(e);
  if (id) {
    const before = src.split('\n').slice(Math.max(0, line - 40), line).join('\n');
    const all = [...before.matchAll(new RegExp(`(?:const|let)\\s+${id[1]}\\s*(?::[^=]+)?=\\s*`, 'g'))];
    const last = all[all.length - 1];
    if (last) {
      const rest = before.slice(last.index + last[0].length);
      const lit = rest.match(LIT)?.[0];
      if (lit) return viaLit(lit);
      const call = /^(?:this\.)?(?:\w+\.)*(\w+)\s*\(/.exec(rest) ?? /^(?:\w+\.)+(\w+)/.exec(rest);
      if (call) return viaLit(lookup(call[1], file, index));
    }
    return viaLit(lookup(id[1], file, index));
  }
  const callee = /^(?:this\.)?(?:\w+\.)*(\w+)\s*(?:\(|$)/.exec(e);
  return callee ? viaLit(lookup(callee[1], file, index)) : null;
}

export { closeParen, splitArgs };
