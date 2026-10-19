// Statements in sql`...` templates that match a shape known to be slow on a big table. A pattern match is a suspicion to measure,
// never a finding on its own.
const SHAPES = [
  ['leading-wildcard LIKE', /\bI?LIKE\s+(?:'%|`%)/i], // a trailing-only wildcard (term || '%') can use an index and is not this
  ['ILIKE on an expression', /\bILIKE\b[^;`]{0,80}\|\|/],
  ['OFFSET pagination', /\bOFFSET\s+\$\{/],
  ['SELECT *', /\bSELECT\s+(?:DISTINCT\s+)?(?:\w+\.)?\*\s+FROM/i],
  ['count(*) FILTER aggregate', /count\(\*\)\s+FILTER\s*\(/i],
  ['ORDER BY random()', /ORDER\s+BY\s+random\(\)/i],
  ['DISTINCT over a join', /SELECT\s+DISTINCT\b[\s\S]{0,300}\bJOIN\b/i],
  [
    'correlated subquery in SELECT list',
    /SELECT[\s\S]{0,200}\(\s*SELECT\s[\s\S]{0,200}\bWHERE\b[\s\S]{0,120}=\s*\w+\.\w+/i,
  ],
  ['json_agg subquery per row', /\(\s*SELECT\s+(?:COALESCE\()?json_agg/i],
];

export function* sqlShapes(source) {
  for (const m of source.matchAll(/\bsql(?:\.raw)?`((?:[^`\\]|\\.)*)`/g)) {
    const body = m[1];
    if (!/\b(SELECT|UPDATE|DELETE|INSERT)\b/i.test(body)) continue;
    const line = source.slice(0, m.index).split('\n').length;
    for (const [shape, re] of SHAPES)
      if (re.test(body))
        yield { shape, line, text: body.replace(/\s+/g, ' ').trim().slice(0, 140) };
  }
}
