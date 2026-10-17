// One builder per QA task. Each takes the task's result from results.json plus the reviewed-exceptions baseline and the XSS sink review,
// and returns what render.page needs. Numbers, lists and verdicts come from the check results, so a rerun on newer code gives a new report;
// the prose around them is the reviewed commentary (what a finding means, how to fix it) and names the facts it relies on.
import { card, code, details, esc, list, section, table, tag } from './render.mjs';

const check = (task, id) => task.checks.find((c) => c.id === id);
const evidence = (task, id) => check(task, id)?.evidence ?? [];
const status = (task, id) => check(task, id)?.status ?? 'skip';
const metric = (task, key, fallback = 0) => task.metrics?.[key] ?? fallback;
const count = (items, key) => {
  const m = new Map();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
const anyFail = (task) => task.checks.some((c) => c.status === 'fail');

// ---------------------------------------------------------------------------------------------------------------------- 30 injection
function build30({ task, baseline }) {
  const raw = evidence(task, 'inj-raw-review');
  const concat = evidence(task, 'inj-concat');
  const reviewed = baseline['30'] ?? [];
  const mod = (e) => e.match(/apps\/api\/src\/(?:modules\/)?([^/]+)/)?.[1] ?? '?';
  const where = (e) => `${mod(e)}${/\/cli\//.test(e) ? '/cli' : '/src'}`;
  const rawByModule = count(raw, mod).slice(0, 8);
  const concatByWhere = count(concat, where);
  const runtimeConcat = concatByWhere
    .filter(([k]) => k.endsWith('/src'))
    .reduce((n, [, c]) => n + c, 0);
  const liveRan = status(task, 'inj-live') !== 'skip';
  const failed = anyFail(task);

  const found =
    card(
      failed ? 'high' : 'ok',
      failed ? 'Fail' : 'Pass',
      'Request data never reaches raw SQL or a shell command',
      `<p>Across ${metric(task, 'sql.raw calls')} <code>sql.raw</code> calls and every <code>query()</code>/<code>execute()</code> template, ${failed ? 'the checks above found request-shaped data in raw SQL or a command: see the failing check.' : 'none interpolates a request-shaped name (<code>search</code>, <code>sort</code>, <code>order</code>, <code>column</code>, <code>filter</code>, <code>q</code>…), and no shell command is built from a template string. That is the check that would be a Critical/High release blocker.'}</p>`,
    ) +
    card(
      'low',
      'Review',
      `${raw.length} raw-SQL arguments are neither a literal nor a constant`,
      `<p>Not defects: fragments built from helper arguments (column aliases, a typed column name, an id list). They stay safe only while every caller passes a literal. Most by module: ${rawByModule.map(([m, n]) => `${code(m)} ${n}`).join(', ') || 'none'}.</p>`,
    ) +
    card(
      'low',
      'Review',
      `${concat.length} query templates use \${} outside the sql tag`,
      `<p>By location: ${concatByWhere.map(([k, n]) => `${code(k)} ${n}`).join(', ') || 'none'}. Seed and CLI scripts (<code>cli/</code>) are developer tools run by an operator; the ${runtimeConcat} under <code>src</code> are runtime code and should be read first.</p>`,
    ) +
    card(
      'ok',
      'Reviewed',
      `${reviewed.length} raw-SQL uses already reviewed and recorded with a reason`,
      list(reviewed.map((x) => `${code(x.key.slice(0, 110))}: ${esc(x.reason)}`)),
    );

  const weak =
    card(
      'med',
      'Medium',
      'Safety depends on every caller passing a literal',
      '<p>Helpers such as <code>channelOwnerSql(alias)</code> accept a string and put it in the SQL unescaped. Today the callers pass literals; a future caller passing request text would be injection. <b>Fix:</b> validate aliases against <code>/^[a-z_][a-z0-9_]*$/i</code> inside the helper, use <code>sql.identifier()</code> for names, and add a lint rule that flags <code>sql.raw</code> with a template interpolation.</p>',
    ) +
    (liveRan
      ? ''
      : card(
          'med',
          'Medium',
          'The live attack suite has not run',
          '<p>About 30 SQLi/NoSQLi/command/header payloads against every parameterless GET route, login and headers are implemented but need a localhost API. Until it runs, the target is shown by code analysis only, not by an attack.</p>',
        )) +
    card(
      'low',
      'Low',
      'One reviewed exception still needs a confirmation',
      '<p>The marketplace browse sort relies on a fixed map keyed by an enum; its baseline note says to confirm <code>q.sort</code> is validated by the zod enum. That confirmation is not recorded.</p>',
    );

  const finish = list([
    'Run the live attacks: <code>API_URL=http://localhost:3000 QA_EMAIL=… QA_PASSWORD=… pnpm qa 30</code> (localhost only; other hosts are refused).',
    `Read the ${runtimeConcat} runtime template queries and baseline them with a reason, or fix them.`,
    'Add the lint rule and the alias validator above.',
    'Run it on every PR and nightly, as the target states, and check that CI actually runs <code>pnpm qa</code>.',
  ]);

  return {
    title: 'Injection testing',
    slug: 'injection-testing',
    verdictClass: failed ? 'red' : liveRan ? 'grn' : '',
    verdictHtml: failed
      ? '<b>Target not met: a check found request data reaching raw SQL or a command.</b>'
      : liveRan
        ? '<b>Static and live checks passed.</b>'
        : '<b>Static result: no injection path found. Target not yet demonstrated.</b><br>Code analysis is clean for Critical/High. The live payload attacks did not run, so the target is shown by reading code, not by attacking a running API.',
    tiles: [
      ['sql.raw calls', metric(task, 'sql.raw calls')],
      ['review items', raw.length + concat.length],
      ['reviewed exceptions', reviewed.length],
      ['live requests', metric(task, 'live requests')],
    ],
    sections:
      section('What was found', found) +
      section('Weak points', weak) +
      section('How to finish this task', finish) +
      section(
        'Appendix: every review item',
        details(`Raw-SQL arguments (${raw.length})`, list(raw.map((e) => code(e)))) +
          details(
            `Query templates with interpolation (${concat.length})`,
            list(concat.map((e) => code(e.slice(0, 200)))),
          ),
      ),
  };
}

// ---------------------------------------------------------------------------------------------------------------------- 31 XSS
const VERDICT_TAG = {
  safe: 'pass',
  'safe*': 'pass',
  'not traced': 'warn',
  'accepted risk': 'fail',
  'not reviewed': 'skip',
};

function build31({ task, sinkReview }) {
  const sinks = [
    ...evidence(task, 'xss-sink-dangerouslysetinnerhtml'),
    ...evidence(task, 'xss-sink-innerhtml'),
  ];
  const judged = sinks.map((e) => {
    const m = e.match(/^(\S+?):(\d+)\s+([\s\S]*)$/);
    const [file, line, snippet] = m ? [m[1], m[2], m[3]] : [e, '?', ''];
    const hit = sinkReview.find(
      (r) => file.endsWith(r.file) && (!r.contains || snippet.includes(r.contains)),
    );
    return {
      file,
      line,
      verdict: hit?.verdict ?? 'not reviewed',
      why: hit?.why ?? 'No entry in data/xss-sink-review.json: read this sink and add one.',
    };
  });
  const tally = (v) =>
    judged.filter((j) => (v === 'safe' ? j.verdict.startsWith('safe') : j.verdict === v)).length;
  const safe = tally('safe');
  const notTraced = tally('not traced');
  const accepted = tally('accepted risk');
  const unreviewed = tally('not reviewed');
  const liveRan = status(task, 'xss-live') !== 'skip';
  const failed = anyFail(task);
  const short = (f) => f.replace(/^apps\/web\/src\/(?:features\/|app\/)?/, '');

  const found =
    `<p>${sinks.length} places write HTML into the page (${evidence(task, 'xss-sink-dangerouslysetinnerhtml').length} <code>dangerouslySetInnerHTML</code>, ${evidence(task, 'xss-sink-innerhtml').length} <code>innerHTML</code>) and no review is recorded for them in <code>data/baseline.json</code>. Each was read: <b>${safe}</b> are safe (escaped, constant, or sanitised on the server), <b>${notTraced}</b> were not traced to their source, <b>${accepted}</b> are accepted-risk by design${unreviewed ? `, and <b>${unreviewed}</b> are new and not yet reviewed` : ''}. Those marked <code>safe*</code> are safe only while the sanitiser they depend on stays in place.</p>` +
    table(
      ['Sink', 'Verdict', 'Why'],
      judged.map((j) => [
        code(`${short(j.file)}:${j.line}`),
        tag(VERDICT_TAG[j.verdict] ?? 'skip', j.verdict),
        esc(j.why),
      ]),
    );

  const weak =
    card(
      'med',
      'Medium',
      'Public custom JavaScript and CSS are raw by design',
      '<p><code>site-head.tsx</code> writes super-admin custom JS and CSS straight into every public page. A compromised or phished super-admin account becomes site-wide script execution. <b>Fix:</b> require MFA and a re-auth for that setting, record every change in the audit log, and consider serving custom JS from a separate origin with a CSP.</p>',
    ) +
    card(
      'med',
      'Medium',
      'Several sinks rest on a server sanitiser staying in every write path',
      '<p>Blog, legal pages, CMS rich text, footers and email templates are safe because the server sanitises on write (and often on read). A new write path that skips <code>HtmlSanitizerService</code> would silently reopen all of them. <b>Fix:</b> sanitise on read as well wherever it is not already, and add a test that every route which stores HTML runs it.</p>',
    ) +
    (notTraced + unreviewed > 0
      ? card(
          'med',
          'Medium',
          `${notTraced + unreviewed} sinks are not traced or not reviewed`,
          `<p>Until each is traced and written to <code>baseline.json</code> with a reason, the task cannot turn green, and a later change to those values would not be noticed: ${judged
            .filter((j) => j.verdict === 'not traced' || j.verdict === 'not reviewed')
            .map((j) => code(`${short(j.file)}:${j.line}`))
            .join(', ')}.</p>`,
        )
      : '') +
    (liveRan
      ? ''
      : card(
          'low',
          'Low',
          'Browser and live checks have not run',
          '<p>The Playwright spec (16 payloads on stored and reflected pages) exists but was not executed, and the live reflection/header check needs a localhost API and web app.</p>',
        ));

  const passes = list(task.checks.filter((c) => c.status === 'pass').map((c) => `${esc(c.title)}`));
  const finish = list([
    `Trace the ${notTraced + unreviewed} open sinks and record all ${sinks.length} in <code>tools/qa-suite/data/baseline.json</code> under <code>31</code>, each with a reason.`,
    'Run the browser spec: <code>pnpm qa 31 -- --run-playwright</code> with <code>WEB_URL</code> and <code>API_URL</code> on localhost.',
    'Harden the custom-code setting (MFA, audit, CSP) and add the "every HTML-storing route sanitises" test.',
  ]);

  return {
    title: 'XSS testing',
    slug: 'xss-testing',
    verdictClass: failed ? 'red' : sinks.length === 0 && liveRan ? 'grn' : '',
    verdictHtml: failed
      ? '<b>Target not met: a check failed.</b>'
      : `<b>${sinks.length === 0 ? 'No unreviewed sinks.' : `No confirmed XSS. Review of the ${sinks.length} sinks is not recorded${liveRan ? '' : ', and the browser and live checks have not run'}.`}</b><br>${sinks.length ? `Every sink was read: ${safe} are safe, ${notTraced + unreviewed} need tracing, ${accepted} are accepted-risk custom code. The target stays unproven until the review is written down and the browser spec executes.` : ''}`,
    tiles: [
      ['sink uses', metric(task, 'sink uses', sinks.length)],
      ['files scanned', metric(task, 'files scanned')],
      ['payloads in spec', metric(task, 'payloads')],
      ['safe / not traced / accepted', `${safe} / ${notTraced + unreviewed} / ${accepted}`],
    ],
    sections:
      section('What was found', found) +
      section('Weak points', weak) +
      section('What passes', passes) +
      section('How to finish this task', finish),
  };
}

// ---------------------------------------------------------------------------------------------------------------------- 36 audit
const KNOWN_AUDIT = {
  'google-account':
    'Delegates to <code>appointments-booking</code>, which writes the rows (disconnect, consent confirm, calendar select); <code>connect</code> only returns a consent URL. A false positive of the per-module count: record it in the baseline.',
  'ai-copilot-lead-finder':
    "<code>POST settings</code> changes <code>workspace_settings.wa_copilot_enabled</code> and must write an audit row; chat turns are logged in the copilot's own action table.",
};

function build36({ task, baseline }) {
  const flagged = evidence(task, 'aud-module-coverage').map((e) => {
    const m = e.match(/^(\S+): (\d+) mutating route\(s\), (\d+) audit calls\s+\((.+)\)$/);
    return m ? { module: m[1], routes: m[2], file: m[4] } : { module: e, routes: '?', file: '' };
  });
  const reviewed = baseline['36'] ?? [];
  const covFailed = status(task, 'aud-module-coverage') === 'fail';
  const modules = metric(task, 'modules');
  const appendOnly = status(task, 'aud-append-only') === 'pass';

  const found =
    (covFailed
      ? card(
          'high',
          'Fail',
          `${flagged.length} module(s) with mutating routes have no audit calls`,
          table(
            ['Module', 'Mutating routes', 'File', 'What reading the code says'],
            flagged.map((f) => [
              code(f.module),
              esc(f.routes),
              code(f.file),
              KNOWN_AUDIT[f.module] ??
                'Not reviewed: read the routes and either add <code>audit.record</code> or baseline it with a reason.',
            ]),
          ),
        )
      : card(
          'ok',
          'Pass',
          `Every one of ${modules} modules with mutating routes audits, or is a reviewed exception`,
          `<p>${metric(task, 'mutating routes')} mutating routes and ${metric(task, 'audit.record calls')} <code>audit.record</code> calls. ${reviewed.length} module(s) are baselined with a written reason because they delegate their audit to another module's service:</p>${list(reviewed.map((x) => `${code(x.key.slice(0, 120))}: ${esc(x.reason)}`))}`,
        )) +
    card(
      appendOnly ? 'ok' : 'high',
      appendOnly ? 'Pass' : 'Fail',
      appendOnly
        ? 'audit_log cannot be changed or erased by the application'
        : 'audit_log is not append-only',
      appendOnly
        ? '<p>A trigger refuses every UPDATE and refuses DELETE unless the transaction is privileged. The retention prune and workspace erasure already run privileged. Re-proved by <code>apps/api/test/integration/db-guards.spec.ts</code> on every run of the integration suite.</p>'
        : `<p>${esc(check(task, 'aud-append-only')?.detail ?? '')}</p>`,
    ) +
    card(
      'ok',
      'Pass',
      'Secrets, columns and tests',
      `<p>${esc(check(task, 'aud-no-secrets')?.title ?? '')} (${status(task, 'aud-no-secrets')}); ${esc(check(task, 'aud-columns')?.title ?? '')} (${status(task, 'aud-columns')}); ${esc(check(task, 'aud-e2e')?.title ?? '')} (${status(task, 'aud-e2e')}).</p>`,
    );

  const weak =
    card(
      'med',
      'Medium',
      'Application-role bypass remains possible',
      '<p>The append-only trigger allows DELETE when <code>app.privileged</code> is on. Anything that can already run arbitrary SQL as the app role can set it. The trigger closes bugs and ordinary sessions, not a full SQL-level compromise. The export plus the retention window are the second line.</p>',
    ) +
    card(
      'low',
      'Low',
      'The coverage check counts audit calls per module, not per route',
      "<p>It reads each module's own files, so a controller that delegates to another module's service looks unaudited (handled through the baseline), and a module with one audited route and one unaudited route passes. Treat it as a floor, not proof every mutation is recorded.</p>",
    ) +
    card(
      'low',
      'Low',
      'Behavior tests need the Docker stack',
      '<p>The e2e suite (<code>apps/api/test/e2e/audit-log</code>) proves a row appears after a real mutation; it was not run by this report.</p>',
    );

  return {
    title: 'Audit logging',
    slug: 'audit-logging',
    verdictClass: covFailed || !appendOnly ? 'red' : 'grn',
    verdictHtml: covFailed
      ? `<b>Target not met: ${flagged.length} module(s) write no audit rows.</b>`
      : '<b>Static checks pass: every mutating module audits or is a reviewed exception, and audit_log is append-only.</b><br>Behavior is covered by the e2e and integration suites, which this report does not run.',
    tiles: [
      ['modules', modules],
      ['mutating routes', metric(task, 'mutating routes')],
      ['audit.record calls', metric(task, 'audit.record calls')],
      ['modules without audit', metric(task, 'modules without audit')],
    ],
    sections:
      section('What was found', found) +
      section('Weak points', weak) +
      section(
        'How to keep this task green',
        list([
          'Run the guard spec any time: <code>pnpm --filter @crm/api exec vitest run test/integration/db-guards.spec.ts --testTimeout=120000</code>.',
          'Run the audit-log e2e suite against the Docker stack and keep it in the nightly run.',
          'Run <code>pnpm qa 36 -- --fail</code> in PR checks so a new module cannot ship without audit calls.',
        ]),
      ),
  };
}

// ---------------------------------------------------------------------------------------------------------------------- 40 indexing
function build40({ task }) {
  const fk = evidence(task, 'idx-fk');
  const redundant = evidence(task, 'idx-redundant');
  const fkTables = count(fk, (e) => e.match(/^(\w+)\(/)?.[1] ?? '?');
  const fkRows = fk.map((e) => {
    const m = e.match(/^(\w+)\(([^)]*)\) -> (\S+)\s+\[(.+)\]$/);
    return m
      ? [code(m[1]), code(m[2]), code(m[3]), code(m[4].split('/').pop())]
      : [esc(e), '', '', ''];
  });
  const redundantRows = redundant.map((e) => {
    const m = e.match(/^(\w+): (\w+)\(([^)]*)\) is a prefix of (\w+)\((.*)\)$/);
    return m ? [code(m[1]), code(`${m[2]}(${m[3]})`), code(`${m[4]}(${m[5]})`)] : [esc(e), '', ''];
  });
  const critical = status(task, 'idx-critical') === 'pass';
  const liveRan = status(task, 'idx-live-unused') !== 'skip';
  const failed = anyFail(task);

  const found =
    card(
      critical ? 'ok' : 'high',
      critical ? 'Pass' : 'Fail',
      critical
        ? 'Every critical query pattern is served by an index'
        : 'A critical query pattern has no serving index',
      `<p>${esc(check(task, 'idx-critical')?.title ?? '')}. The register is <code>tools/qa-suite/data/critical-queries.json</code>. ${status(task, 'idx-tenant-lead') === 'pass' ? 'Btree indexes on tenant tables lead with <code>org_id</code>, so row-level security and tenant filters use them.' : ''}</p>`,
    ) +
    (redundant.length
      ? card(
          'med',
          'Medium',
          `${redundant.length} redundant index(es) (a strict prefix of another index)`,
          table(['Table', 'Redundant index', 'Covered by'], redundantRows) +
            '<p class="k">Each costs write time and storage. Check <code>pg_stat_user_indexes</code> on a real database before dropping, and remember a btree scans backward, so an ascending <code>(org_id, x)</code> order is served by <code>(org_id, x DESC, id DESC)</code>.</p>',
        )
      : card(
          'ok',
          'Pass',
          'No redundant indexes',
          '<p>No index is a strict prefix of another. Seven were dropped by migration <code>20261211110000_drop_redundant_indexes</code>; <code>apps/api/test/integration/db-guards.spec.ts</code> proves they stay gone and their replacements stay in place.</p>',
        )) +
    card(
      fk.length ? 'low' : 'ok',
      fk.length ? 'Low' : 'Pass',
      `${fk.length} of ${metric(task, 'foreign keys')} foreign keys have no covering index (${fkTables.length} tables)`,
      fk.length
        ? `<p>A foreign key without an index makes a delete or update of the parent row scan the child table, and slows joins by that key. This matters for tables that grow (contact timeline tables, flow logs) and rarely for small lookup tables. Largest groups: ${fkTables
            .slice(0, 8)
            .map(([t, n]) => `${code(t)} ${n}`)
            .join(', ')}. Full list in the appendix.</p>`
        : '<p>Every foreign key has a covering index.</p>',
    );

  const weak =
    (redundant.length
      ? card(
          'med',
          'Medium',
          'The target says "no redundant critical indexes"',
          '<p>Whether each is a <i>critical</i> index is a judgement; the tool flags every prefix. Until each is dropped or recorded as justified, the target is not strictly met.</p>',
        )
      : '') +
    (liveRan
      ? ''
      : card(
          'med',
          'Medium',
          'Unused-index and plan checks need a live database',
          '<p>The check that lists indexes never used since stats reset (<code>pg_stat_user_indexes</code>) was skipped because <code>DATABASE_URL</code> was not set. Without it, "unjustified" indexes cannot be identified, only "redundant" ones.</p>',
        )) +
    card(
      'low',
      'Low',
      'Static model of the schema',
      '<p>Indexes come from reading the SQL migrations (including drops and renames), not from a real database. A hand-made index in production would be invisible, and so would an index that exists in a migration but failed to build.</p>',
    );

  const finish = list([
    redundant.length
      ? 'Drop or justify the redundant indexes (one migration, after checking usage on a seeded database).'
      : 'Keep the redundant-index check in PR checks: <code>pnpm qa 40 -- --fail</code>.',
    'Add covering indexes for the foreign keys on tables that grow or are deleted from in bulk; baseline the small lookup tables with a reason.',
    'Run with a seeded database: <code>DATABASE_URL=… pnpm qa 40</code> for unused-index results; pair with task 42 (EXPLAIN plans).',
  ]);

  return {
    title: 'DB indexing audit',
    slug: 'db-indexing-audit',
    verdictClass: failed ? 'red' : '',
    verdictHtml: failed
      ? '<b>Target not met: a critical query pattern has no serving index.</b>'
      : redundant.length
        ? `<b>Critical queries are covered. Target not strictly met: ${redundant.length} redundant index(es) remain.</b><br>${fk.length} foreign keys also lack a covering index; most are low risk but need review.`
        : `<b>Critical queries are covered and no index is redundant.</b><br>${fk.length} foreign keys lack a covering index; most are low risk but need review.${liveRan ? '' : ' Unused-index results need a live database.'}`,
    tiles: [
      ['tables', metric(task, 'tables')],
      ['indexes', metric(task, 'indexes')],
      ['foreign keys', metric(task, 'foreign keys')],
      ['critical patterns reviewed', metric(task, 'critical patterns reviewed')],
      ['redundant indexes', redundant.length],
      ['uncovered FKs', fk.length],
    ],
    sections:
      section('What was found', found) +
      section('Weak points', weak) +
      section('How to finish this task', finish) +
      (fk.length
        ? section(
            'Appendix: foreign keys with no covering index',
            details(
              `All ${fk.length} (table, columns, references, migration)`,
              table(['Table', 'Columns', 'References', 'Migration'], fkRows),
            ),
          )
        : ''),
  };
}

// ---------------------------------------------------------------------------------------------------------------------- 41 slow queries
function build41({ task }) {
  const pss = task.checks.filter((c) => c.id.startsWith('slow-pss-'));
  const logs = task.checks.filter((c) => c.id.startsWith('slow-log-'));
  const explain = task.checks.filter((c) => c.id.startsWith('slow-autoexplain-'));
  const ok = (cs) => cs.filter((c) => c.status === 'pass').length;
  const liveRan = status(task, 'slow-live') !== 'skip';
  const failed = anyFail(task);
  const file = (c, prefix) => c.id.slice(prefix.length);

  const found =
    card(
      ok(pss) === pss.length && pss.length ? 'ok' : 'high',
      ok(pss) === pss.length && pss.length ? 'Pass' : 'Fail',
      `pg_stat_statements is preloaded in ${ok(pss)} of ${pss.length} Postgres definitions`,
      `<p>${pss.map((c) => `${code(file(c, 'slow-pss-'))} ${tag(c.status)}`).join(' ')}. Each starts Postgres with <code>shared_preload_libraries=pg_stat_statements</code> and <code>pg_stat_statements.track=all</code>; migration <code>20261211100000</code> creates the extension (guarded, idempotent). <code>apps/api/test/integration/db-guards.spec.ts</code> proves the library is preloaded and queryable on a fresh database.</p>`,
    ) +
    card(
      ok(logs) === logs.length && logs.length ? 'ok' : 'high',
      ok(logs) === logs.length && logs.length ? 'Pass' : 'Fail',
      `Slow statements are logged in ${ok(logs)} of ${logs.length}`,
      `<p>${esc(logs[0]?.detail ?? '')}</p>`,
    ) +
    (explain.length
      ? card(
          'low',
          'Review',
          'auto_explain is not enabled (optional)',
          `<p>${explain.map((c) => code(file(c, 'slow-autoexplain-'))).join(', ')}: plans of slow statements are not captured automatically. Adding <code>auto_explain</code> with <code>auto_explain.log_min_duration</code> set to the threshold would record the plan of every slow query as it happens.</p>`,
        )
      : '') +
    (liveRan
      ? card(
          'ok',
          'Ran',
          'Live ranking ran',
          `<p>${esc(check(task, 'slow-live')?.detail ?? '')}</p>`,
        )
      : card(
          'low',
          'Not run',
          'Ranking and p95 need a live database',
          `<p>Parsing the Postgres log (<code>QA_PG_LOG</code>) and ranking statements by total and mean time from <code>pg_stat_statements</code> (<code>DATABASE_URL</code>) were skipped, so <b>${metric(task, 'statements ranked')} statements were ranked</b> and the critical p95 target is not measured.</p>`,
        ));

  const weak =
    card(
      'med',
      'Medium',
      'Existing databases keep the old settings until Postgres restarts',
      '<p><code>shared_preload_libraries</code> is read at start. A running production database captures nothing until it is restarted with the new setting. Plan the restart in a maintenance window.</p>',
    ) +
    card(
      'med',
      'Medium',
      `The log threshold is above the ${metric(task, 'threshold ms')} ms target`,
      `<p>Everything between the target and the logged threshold is visible only through <code>pg_stat_statements</code>, which stores totals and means, not a histogram. The p95 the check reports is an estimate (mean + 1.645 × standard deviation, assuming a normal shape) and will be wrong for skewed timings. <b>Fix:</b> lower the threshold for the measurement run, and take p95 from load-test traces (task 54) rather than from the estimate.</p>`,
    ) +
    card(
      'low',
      'Low',
      'Overhead and reset',
      '<p><code>pg_stat_statements.track=all</code> adds a small per-statement cost, and its counters reset on <code>pg_stat_statements_reset()</code> or a restart. Take a ranking after each load run before resetting.</p>',
    );

  const finish = list([
    'Run the load test first (task 54), then: <code>DATABASE_URL=… QA_PG_LOG=/path/to/postgresql.log QA_SLOW_MS=100 pnpm qa 41</code> against a seeded database.',
    'Restart the production Postgres to pick up the preload; verify with <code>SHOW shared_preload_libraries</code>.',
    'Optionally enable <code>auto_explain</code>; record the top-10 statements and their before/after times in <code>docs/quality</code>.',
  ]);

  return {
    title: 'Slow-query analysis',
    slug: 'slow-query-analysis',
    verdictClass: failed ? 'red' : '',
    verdictHtml: failed
      ? '<b>Target not met: capture is not configured everywhere.</b>'
      : `<b>Capture is configured; the target ${liveRan ? 'was measured' : 'is not measured'}.</b><br>The log and <code>pg_stat_statements</code> are set up in ${ok(pss)} of ${pss.length} environments.${liveRan ? '' : ' No statements were ranked and no p95 was produced, because that needs a running database under load.'}`,
    tiles: [
      ['compose files configured', `${ok(pss)} / ${pss.length}`],
      ['task threshold', `${metric(task, 'threshold ms')} ms`],
      ['statements ranked', metric(task, 'statements ranked')],
    ],
    sections:
      section('What was found', found) +
      section('Weak points', weak) +
      section('How to finish this task', finish),
  };
}

export const BUILDERS = { 30: build30, 31: build31, 36: build36, 40: build40, 41: build41 };
export const REPORT_TASKS = Object.keys(BUILDERS).map(Number);
