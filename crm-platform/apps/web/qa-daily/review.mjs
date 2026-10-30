// Goldfish review with the official Elephant-Goldfish Model plugin (github.com/google/elephant-goldfish-model, `egm@egm`).
// Nothing here reviews anything: it writes the change as a document, runs the plugin's own `/egm:egm-review` on it unattended
// (Step: uninterrupted -> its reviewer agents + synthesizer run in fresh contexts) and reads the report the plugin writes.
//   const { approved, blockers, findings, report } = await goldfishReview({ cwd, task, notes, kind: 'fix' | 'tests' });
// Needs: `claude plugin marketplace add google/elephant-goldfish-model && claude plugin install egm@egm`.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, git, log } from './lib.mjs';

const PLUGIN = join(process.env.HOME ?? '', '.claude/plugins/marketplaces/egm');
const REPORT = 'consolidated_review_report.md'; // written by egm-review "Consolidated report with all review rubrics"

/** The change as the plugin wants to read it: a spec part, then a `## Detailed Implementation Plan` (the boundary it looks for). */
function changeRecord({ cwd, task, notes, kind }) {
  git(cwd, 'add', '-N', '.'); // new files show up in `git diff HEAD`
  const files = git(cwd, 'diff', '--name-only', '--no-renames', 'HEAD').split('\n').filter(Boolean);
  const diff = git(cwd, 'diff', 'HEAD').slice(0, 60_000);
  const what =
    kind === 'tests'
      ? 'New and updated daily QA journeys (Playwright tests that run against a live production account)'
      : 'A bug fix found by the daily QA run';
  return `# Change record: ${what}

## Problem and goal

${task}

## Expected behaviour

${
  kind === 'tests'
    ? 'Each journey tests one real user flow, uses only data it creates and removes, never sends, charges, publishes or deletes real data on production, and is not flaky.'
    : 'The failing check passes, the root cause is fixed, nothing unrelated changes, and no test was weakened to get a pass.'
}

## Root cause and approach

${notes || 'See the diff below.'}

## Detailed Implementation Plan

### Files changed

${files.map((f) => `- [${f}](${join(cwd, f)})`).join('\n')}

### Diff

\`\`\`diff
${diff}
\`\`\`
`;
}

const run = (cwd, args) =>
  new Promise((resolve) => {
    let out = '';
    const p = spawn('claude', args, {
      cwd,
      env: { ...process.env, ANTHROPIC_API_KEY: undefined },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const t = setTimeout(() => p.kill('SIGKILL'), 45 * 60_000);
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => {
      clearTimeout(t);
      resolve(out);
    });
  });

/** The plugin reports severities as 🔴 Blocker, 🟡 Major, 🟢 Nit. */
function findingsOf(report) {
  const found = [];
  let severity = null;
  for (const line of report.split('\n')) {
    const h = line.match(/^#+\s*(🔴|🟡|🟢)/);
    if (h) severity = h[1] === '🔴' ? 'blocker' : h[1] === '🟡' ? 'major' : 'nit';
    else if (severity && /^\|\s*[A-Z]+\d+\s*\|/.test(line))
      found.push({
        severity,
        issue: line
          .split('|')
          .slice(2)
          .map((c) => c.trim())
          .sort((a, b) => b.length - a.length)[0]
          .slice(0, 300),
      });
  }
  return found;
}

export async function goldfishReview({ cwd, task, notes = '', kind = 'fix' }) {
  if (!existsSync(PLUGIN))
    return {
      approved: false,
      blockers: [{ severity: 'blocker', issue: 'egm plugin is not installed' }],
      findings: [],
      report: '',
    };
  // The plugin must run its five reviewer stages in fresh contexts. A "single-reader review by the orchestrating agent" is the elephant
  // judging itself, so it is refused: one retry with an explicit instruction, then the review counts as not done.
  const STAGES = [
    'zoom_out',
    'comprehension',
    'critic',
    'intermediate_zoom_out',
    'implementation_readiness',
  ];
  let dir = '';
  let out = '';
  let missing = STAGES;
  for (let attempt = 1; attempt <= 2 && missing.length; attempt++) {
    dir = join(OUT, 'review', `${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const doc = join(dir, 'change_record.md');
    writeFileSync(doc, changeRecord({ cwd, task, notes, kind }));
    // cwd is the artifact folder, so the plugin's drafts and reports land there and the code under review is never edited
    out = await run(dir, [
      '-p',
      `/egm:egm-review TargetFile=${doc} Step=uninterrupted. EGM artifact directory: ${dir}\n` +
        `This is an unattended run: do not ask questions, do not pause at checkpoints, do not edit any file other than reports in the artifact directory. ` +
        `The changed code is in ${cwd} (read-only for you); the diff is in the document. Write ${REPORT} and end with one line: VERDICT: approve or VERDICT: changes.` +
        (attempt > 1
          ? `\nA previous run skipped the reviewer stages because the change was small. That is not allowed: run ALL five stages, each through its own reviewer subagent, however small the change.`
          : ''),
      '--permission-mode',
      'acceptEdits', // cwd is the artifact folder: the only place the plugin can write
      '--max-turns',
      '150',
      '--allowedTools',
      `Read Grep Glob Agent Bash(git diff:*) Bash(git status:*) Bash(git show:*) Bash(git log:*)`,
    ]);
    missing = STAGES.filter((st) => !existsSync(join(dir, `${st}_report.md`)));
  }
  if (missing.length)
    return {
      approved: false,
      blockers: [
        {
          severity: 'blocker',
          issue: `the goldfish stages did not run (no report for: ${missing.join(', ')}); a single-reader review does not count`,
        },
      ],
      findings: [],
      report: '',
    };

  const file = [
    join(dir, REPORT),
    ...readdirSync(dir)
      .filter((f) => /report.*\.md$/i.test(f))
      .map((f) => join(dir, f)),
  ].find(existsSync);
  if (!file)
    return {
      approved: false,
      blockers: [{ severity: 'blocker', issue: 'the egm review produced no report' }],
      findings: [],
      report: '',
    };
  const report = readFileSync(file, 'utf8');
  const findings = findingsOf(report);
  const blockers = findings.filter((f) => f.severity !== 'nit');
  // no explicit verdict = no approval: a report we could not read must never pass a change
  const verdict = [...out.matchAll(/^VERDICT:\s*(approve|changes)\s*$/gim)]
    .pop()?.[1]
    ?.toLowerCase();
  if (!verdict)
    blockers.push({ severity: 'blocker', issue: 'the egm review gave no VERDICT line' });
  else if (verdict === 'changes' && !blockers.length)
    blockers.push({ severity: 'blocker', issue: 'the egm review asked for changes' });
  log(`goldfish (egm): ${findings.length} findings, ${blockers.length} blocking, report ${file}`);
  return { approved: blockers.length === 0, blockers, findings, report: file };
}
