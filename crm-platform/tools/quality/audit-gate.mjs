#!/usr/bin/env node
// Dependency audit gate (QA task 27). Reads `pnpm audit --json` for production dependencies and for everything, and a list of
// reviewed findings, and decides pass or fail:
//   production dependency, high or critical  -> fail
//   development dependency, critical          -> fail (high is reported, not blocking)
//   an accepted finding past its end date     -> fail (a decision made once must be made again)
// A finding is accepted only in `.audit-accepted.json`, with a reason and an end date.
import { readFileSync, existsSync } from 'node:fs';

/** @param {{prod: any, all: any, accepted: Array<{id:string, reason:string, expires:string}>, today?: string}} input */
export function gate({ prod, all, accepted, today = new Date().toISOString().slice(0, 10) }) {
  const problems = [];
  const reported = [];
  const accept = new Map(accepted.map((a) => [a.id, a]));
  for (const a of accepted) {
    if (!a.reason || !a.expires) problems.push(`accepted ${a.id} needs a reason and an end date`);
    else if (a.expires < today)
      problems.push(`accepted ${a.id} expired on ${a.expires}: fix it or decide again`);
  }
  const prodIds = new Set(Object.values(prod?.advisories ?? {}).map((x) => x.github_advisory_id));
  for (const adv of Object.values(all?.advisories ?? {})) {
    const id = adv.github_advisory_id;
    const inProd = prodIds.has(id);
    const sev = adv.severity;
    const blocking = inProd ? sev === 'high' || sev === 'critical' : sev === 'critical';
    const line = `${sev} ${adv.module_name} ${id} (${inProd ? 'production' : 'development'}): ${adv.title}`;
    if (sev !== 'high' && sev !== 'critical') continue;
    if (accept.has(id)) reported.push(`accepted  ${line}`);
    else if (blocking) problems.push(line);
    else reported.push(`reported  ${line}`);
  }
  return { ok: problems.length === 0, problems, reported };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , prodFile, allFile, acceptedFile = '.audit-accepted.json'] = process.argv;
  const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
  const accepted = existsSync(acceptedFile) ? read(acceptedFile) : [];
  const r = gate({ prod: read(prodFile), all: read(allFile), accepted });
  for (const l of r.reported) console.log(l);
  for (const p of r.problems) console.log(`BLOCKING  ${p}`);
  console.log(r.ok ? 'dependency gate: pass' : `dependency gate: FAIL (${r.problems.length})`);
  process.exit(r.ok ? 0 : 1);
}
