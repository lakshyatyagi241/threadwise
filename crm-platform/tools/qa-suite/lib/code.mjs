// Tiny TypeScript scanner helpers: no AST, but string/comment aware brace and paren matching.
export function maskCode(src) {
  // blank out comments and string contents, keep length and newlines so offsets stay valid
  let out = '',
    i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i],
      d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  ';
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += q;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        out += src[i] === '\n' ? '\n' : q === '`' && false ? src[i] : ' ';
        i++;
      }
      out += q;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
/** index of the bracket matching the opener at `open` (in masked text), or -1 */
export function matchClose(masked, open) {
  const o = masked[open],
    c = { '(': ')', '{': '}', '[': ']' }[o];
  let d = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === o) d++;
    else if (masked[i] === c && --d === 0) return i;
  }
  return -1;
}
export const lineAt = (text, idx) => text.slice(0, idx).split('\n').length;
