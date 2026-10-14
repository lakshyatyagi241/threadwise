// #26 SAST: runs tools/sast-report and requires zero unresolved Critical/High; also checks that it runs on every PR.
import { ROOT, expectNone, fail, pass, read, sh, walk, warn } from '../lib/core.mjs';
import { join } from 'node:path';

export default {
  id: 26,
  priority: 'P1',
  name: 'SAST',
  owner: 'Punya',
  target: 'Every PR; zero unresolved Critical/High',
  async run() {
    const r = sh('node', ['tools/sast-report/run.mjs', '--no-deps']);
    const checks = [];
    let m;
    try {
      m = JSON.parse(read(join(ROOT, 'reports/sast/latest/findings.json')));
    } catch {
      return {
        checks: [fail('sast-run', 'SAST report ran', (r.stderr || r.stdout).slice(0, 300))],
      };
    }
    const open = m.rules
      .filter((x) => ['critical', 'high'].includes(x.sev))
      .flatMap((x) =>
        x.hits.map((h) => `[${x.sev}] ${x.id} ${h.file}:${h.line}  ${h.text.slice(0, 90)}`),
      );
    checks.push(
      expectNone(
        'sast-open',
        'No unresolved Critical/High finding (a finding is resolved by a fix or by a reasoned entry in tools/sast-report/baseline.json)',
        open,
        { severity: 'high' },
      ),
    );
    const ext = (m.externalFindings ?? [])
      .filter((f) => ['critical', 'high'].includes(f.sev))
      .map((f) => `[${f.sev}] ${f.tool} ${f.rule} ${f.file}`);
    checks.push(
      expectNone('sast-external', 'No Critical/High from semgrep / gitleaks / trivy', ext),
    );
    for (const t of m.tools.filter((t) => t.status === 'not installed'))
      checks.push(warn(`sast-tool-${t.name}`, `${t.name} installed`, t.note));
    const wf = [...walk(join(ROOT, '..', '.github/workflows'), (p) => /\.ya?ml$/.test(p))].map(
      (f) => [f, read(f)],
    );
    const onPr = wf.some(
      ([, t]) => /sast|semgrep|audit:sast|sast-report/.test(t) && /pull_request/.test(t),
    );
    checks.push(
      onPr
        ? pass('sast-every-pr', 'A workflow runs SAST on every pull request')
        : fail(
            'sast-every-pr',
            'A workflow runs SAST on every pull request',
            'No workflow with a pull_request trigger runs it. The repo\'s automatic workflows were removed in #328 because Actions jobs do not start on this account, so "every PR" needs either Actions restored or a local gate (husky pre-push / the security-review-gate skill, which already calls these audits).',
            [],
            'medium',
          ),
    );
    return {
      checks,
      metrics: { ...m.sevCount, 'reviewed exceptions': m.reviewed?.length ?? 0 },
      target: {
        met: open.length === 0 && ext.length === 0 && onPr,
        text: `${open.length} unresolved Critical/High; PR automation ${onPr ? 'present' : 'absent'}.`,
      },
    };
  },
};
