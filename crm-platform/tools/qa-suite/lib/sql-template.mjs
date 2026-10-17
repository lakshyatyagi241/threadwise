// How safe is the SQL text handed to `.query()` / `.execute()` / `sql.raw()` (QA task 30, injection testing)?
//
// The danger is a `${}` that puts a value INTO the SQL text. A query whose only dynamic parts are `$1`, `$2`, ... placeholders sends its
// values separately, which is the safe form and the one to encourage, so a template literal with no `${` in it is safe however many
// placeholders it has. The classifier must also look at the template ALONE: the text after it is the argument array (`[a, b]`), not SQL.
// Pure and exported so it has its own tests.

/** Names that carry request data; an interpolation reading one of them is a likely injection. */
const REQ =
  /\b(req|request|body|query|params|dto|input|payload|filters?|search|searchTerm|q|sort|order|orderBy|dir|direction|column|field)\b/;

/**
 * The first template literal in `text`, backticks included, or '' when there is none. Handles `${ ... }` holes, including a template
 * nested inside one, and an escaped backtick. Assumes comments and strings are not hiding backticks (the QA code masks them first).
 */
export function templateOf(text) {
  const start = text.indexOf('`');
  if (start < 0) return '';
  let depth = 0; // how many ${ } holes deep we are
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (depth === 0) {
      if (c === '`') return text.slice(start, i + 1);
      if (c === '$' && text[i + 1] === '{') {
        depth = 1;
        i++;
      }
    } else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '`') {
      // a template nested in a hole: skip it whole
      const inner = templateOf(text.slice(i));
      if (!inner) return '';
      i += inner.length - 1;
    }
  }
  return '';
}

/**
 * 'safe': literal, or every ${} is a module constant / number; 'request': an interpolation reads request-shaped data;
 * 'review': dynamic, needs a human.
 * @param {string} arg the SQL argument as written (a string literal, an identifier, or a template literal)
 * @param {Set<string>} consts the module-level constants of the file
 */
export function classify(arg, consts) {
  if (/^(['"])[^$]*\1$/.test(arg)) return 'safe';
  if (arg.startsWith('`') && !arg.includes('${')) return 'safe'; // $1, $2 ... placeholders only
  if (/^[A-Za-z_$][\w$]*$/.test(arg)) return consts.has(arg) ? 'safe' : 'review';
  const exprs = [...arg.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1].trim());
  if (!exprs.length) return 'review';
  if (exprs.some((e) => REQ.test(e))) return 'request';
  if (exprs.every((e) => consts.has(e.split(/[.(\[]/)[0]) || /^\d+$/.test(e))) return 'safe';
  return 'review';
}
