// Constraints added NOT VALID and never validated afterwards (QA task 48, `int-notvalid`).
//
// A migration validates a constraint in one of two ways: a literal `ALTER TABLE t VALIDATE CONSTRAINT name`, or a loop that builds the
// statement from a list of names (`format('ALTER TABLE %s VALIDATE CONSTRAINT %I', ...)` over `conname IN ('a', 'b')`), which is how
// 20261116090100_cat_validate_value_checks does it and the only sensible way to validate nine constraints without leaving one on a
// table that holds a bad row. A search for the literal text alone cannot see the second kind. Only a validation in the SAME or a LATER
// migration counts (a validation that runs before the constraint exists does nothing). Pure and exported so it has its own tests.

/**
 * @param {Array<{ file: string, sql: string }>} migrations every migration, in the order they run
 * @returns {Array<{ file: string, name: string }>} constraints added NOT VALID that no migration validates afterwards
 */
export function neverValidated(migrations) {
  const out = [];
  migrations.forEach((m, at) => {
    for (const add of m.sql.matchAll(/ADD\s+CONSTRAINT\s+(\w+)[^;]*NOT\s+VALID/gi)) {
      const name = add[1];
      const later = migrations.slice(at);
      if (!later.some((l) => validates(l.sql, name))) out.push({ file: m.file, name });
    }
  });
  return out;
}

/** Does this migration validate the constraint, by name or through a loop over a list that names it? */
export function validates(sql, name) {
  if (new RegExp(`VALIDATE\\s+CONSTRAINT\\s+${name}\\b`, 'i').test(sql)) return true;
  const dynamic = /VALIDATE\s+CONSTRAINT\s+(?:%I|%s|\$\{|'\s*\|\|)/i.test(sql);
  return dynamic && new RegExp(`'${name}'`).test(sql);
}
