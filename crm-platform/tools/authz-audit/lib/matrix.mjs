// Policy matrix: actor class x route -> ALLOW | DENY | CONDITIONAL | POLICY-UNDEFINED, derived from the declared gates (never guessed).
// CONDITIONAL = depends on the record scope (all/team/own), plan feature, platform role or key scope. POLICY-UNDEFINED = no declared
// rule decides it; it must never be treated as ALLOW.

const ACTORS = [
  'anonymous',
  'workspace-member-no-grants',
  'workspace-member-with-key',
  'workspace-admin',
  'other-tenant-admin',
  'platform-operator',
  'api-key',
];

function rowsFor(r, policy) {
  const d = {};
  const declared =
    (policy.selfService ?? {})[r.file] ?? (policy.selfService ?? {})[`${r.file}#${r.handler}`];
  switch (r.gate) {
    case 'public':
      for (const a of ACTORS) d[a] = 'ALLOW';
      d.note =
        'public route: must be in baseline/public-routes.json (auth-audit) and throttled or signed';
      break;
    case 'permission':
      Object.assign(d, {
        anonymous: 'DENY',
        'workspace-member-no-grants': 'DENY',
        'workspace-member-with-key': r.objectIdParams.length ? 'CONDITIONAL' : 'ALLOW',
        'workspace-admin': 'ALLOW',
        'other-tenant-admin': r.objectIdParams.length ? 'DENY' : 'ALLOW',
        'platform-operator': 'DENY',
        'api-key': 'DENY',
      });
      d.note = r.objectIdParams.length
        ? 'record scope all/team/own decides per object; foreign tenant object -> 404'
        : 'own tenant only (RLS)';
      break;
    case 'authenticated-only':
      Object.assign(d, {
        anonymous: 'DENY',
        'workspace-member-no-grants': declared ? 'ALLOW' : 'POLICY-UNDEFINED',
        'workspace-member-with-key': declared ? 'ALLOW' : 'POLICY-UNDEFINED',
        'workspace-admin': declared ? 'ALLOW' : 'POLICY-UNDEFINED',
        'other-tenant-admin': 'DENY',
        'platform-operator': 'DENY',
        'api-key': 'DENY',
      });
      d.note = declared
        ? `self-service (${declared.review}): ${declared.reason}`
        : 'NO DECLARED POLICY';
      break;
    case 'operator-permission':
      Object.assign(d, {
        anonymous: 'DENY',
        'workspace-member-no-grants': 'DENY',
        'workspace-member-with-key': 'DENY',
        'workspace-admin': 'DENY',
        'other-tenant-admin': 'DENY',
        'platform-operator': 'CONDITIONAL',
        'api-key': 'DENY',
      });
      d.note = 'platform permission key decides per operator role';
      break;
    case 'operator-or-partner-coarse':
      Object.assign(d, {
        anonymous: 'DENY',
        'workspace-member-no-grants': 'DENY',
        'workspace-member-with-key': 'DENY',
        'workspace-admin': 'DENY',
        'other-tenant-admin': 'DENY',
        'platform-operator': 'POLICY-UNDEFINED',
        'api-key': 'DENY',
      });
      d.note = 'every operator role (or partner agent) passes; no per-action policy declared';
      break;
    case 'api-key':
      Object.assign(d, {
        anonymous: 'DENY',
        'workspace-member-no-grants': 'DENY',
        'workspace-member-with-key': 'DENY',
        'workspace-admin': 'DENY',
        'other-tenant-admin': 'DENY',
        'platform-operator': 'DENY',
        'api-key': 'CONDITIONAL',
      });
      d.note = 'key scope and plan feature (public_api) decide';
      break;
    default:
      for (const a of ACTORS) d[a] = 'POLICY-UNDEFINED';
  }
  return d;
}

export function buildMatrix(routes, policy) {
  const csv = ['route,gate,permissions,' + ACTORS.join(',') + ',note'];
  const byDecision = {};
  for (const r of routes) {
    const d = rowsFor(r, policy);
    for (const a of ACTORS) byDecision[d[a]] = (byDecision[d[a]] ?? 0) + 1;
    csv.push(
      [
        `"${r.id}"`,
        r.gate,
        `"${r.permissions.join(' ')}"`,
        ...ACTORS.map((a) => d[a]),
        `"${(d.note ?? '').replace(/"/g, "'")}"`,
      ].join(','),
    );
  }
  return { csv: csv.join('\n'), rows: routes.length * ACTORS.length, byDecision };
}
