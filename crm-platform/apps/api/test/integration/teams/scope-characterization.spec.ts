import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RecordScope } from '@crm/contracts';
import { startTestPg, type TestPg } from '../../support/pg-it';
import { appointmentScopeCondition } from '../../../src/modules/appointments-booking/appointments.repository';
import { scopeClause } from '../../../src/modules/calling-voice/call-logs.repository';
import { companyScopeCondition } from '../../../src/modules/crm/companies/companies.repository';
import { contactScopeCondition } from '../../../src/modules/crm/contacts/contact-conditions';
import { ownerScope } from '../../../src/modules/crm/crm-dashboard/crm-dashboard.repository';
import { contactOpen } from '../../../src/modules/chat-conversations/message-history.query';
import { dealScopeCondition } from '../../../src/modules/crm/deals/deals.repository';
import { creditNoteScopeCondition } from '../../../src/modules/crm/invoicing/credit-notes.repository';
import { invoiceScopeCondition } from '../../../src/modules/crm/invoicing/invoices.repository';
import { paymentScopeCondition } from '../../../src/modules/crm/invoicing/payments.repository';
import { recurringScopeCondition } from '../../../src/modules/crm/invoicing/recurring-invoices.repository';
import { orderScopeCondition } from '../../../src/modules/crm/invoicing/sales-orders.repository';
import { salesDocScopeCondition } from '../../../src/modules/crm/sales-docs/sales-docs.repository';
import { taskScopeCondition } from '../../../src/modules/crm/tasks/tasks.repository';
import { formScopeCondition } from '../../../src/modules/forms-builder/forms.repository';
import { submissionScopeCondition } from '../../../src/modules/forms-builder/form-submissions.repository';

/**
 * BL-380 (teams T0): characterization of every record-scope condition against a real Postgres, written BEFORE the call sites were moved
 * onto the one ScopeResolver and kept as the guard afterwards.
 *
 * Each module is a "probe": a temp table (or two joined by id) whose person columns hold every combination of
 *   NULL, A (team 1), B (team 1), C (team 2), D (teams 1 and 2), E (no team), F (team 3 alone)
 * and the module's own scope condition is evaluated for every actor (A..F and nobody) at each of own / team / all.
 *
 * Three assertions per module and actor:
 *   1. MODEL      the rows the live condition returns equal the rule written in plain TypeScript (`visible` below).
 *   2. LEGACY     for a module whose old behaviour is kept, the live rows equal the rows of the frozen copy of the old SQL.
 *   3. D1 DELTA   for a module that changed, the live rows are a superset of the legacy rows and every extra row is explained by
 *                 exactly one of the two documented changes: the person CREATED it (D1), or the person is in no team and the old
 *                 `team` scope hid even their own records.
 */

type Fn = (orgId: number, scope: RecordScope, actor: number | null) => SQL | undefined | null;

interface Probe {
  name: string;
  /** Tables joined 1:1 by id. `name` is the table name, `alias` how the condition calls it ('' = no alias, the condition uses the table name). */
  tables: Array<{ table: string; alias: string; columns: string[] }>;
  live: Fn;
  /** A frozen copy of the SQL before BL-380; omitted for a module that had none to keep. */
  legacy?: Fn;
  /** Which columns count as "created by" for the D1 delta explanation. */
  creatorColumns?: string[];
  /** true: the old behaviour must be kept exactly. false: it may only widen as the D1 delta says. */
  unchanged: boolean;
}

const peers = (orgId: number, actor: number) => sql`(SELECT tm2.user_id FROM team_members tm1
      JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
      WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actor})`;

/** `own OR peers` over the given columns: the shape every post-contacts module used. */
const ownOrPeers =
  (ownCols: string[], peerCols: string[]): Fn =>
  (orgId, scope, actor) => {
    if (scope === 'all') return undefined;
    if (!actor) return sql`false`;
    const own = sql.raw(`(${ownCols.map((c) => `${c} = ${actor}`).join(' OR ')})`);
    if (scope === 'own') return own;
    const p = peers(orgId, actor);
    return sql`(${own} OR ${sql.join(
      peerCols.map((c) => sql`${sql.raw(c)} IN ${p}`),
      sql` OR `,
    )})`;
  };

/** `col IN peers` only: the shape contacts, deals and the dashboard used (no created_by, no "me" in team scope). */
const peersOnly =
  (col: string): Fn =>
  (orgId, scope, actor) => {
    if (scope === 'all') return undefined;
    if (!actor) return sql`false`;
    if (scope === 'own') return sql.raw(`${col} = ${actor}`);
    return sql`${sql.raw(col)} IN ${peers(orgId, actor)}`;
  };

const PROBES: Probe[] = [
  {
    name: 'contacts (owner_id; D1 adds created_by)',
    tables: [{ table: 'contacts', alias: '', columns: ['owner_id', 'created_by'] }],
    live: (o, s, a) => contactScopeCondition(o, s, a),
    legacy: peersOnly('contacts.owner_id'),
    creatorColumns: ['created_by'],
    unchanged: false,
  },
  {
    name: 'message history contact panel (ct.owner_id; D1 adds ct.created_by)',
    tables: [{ table: 'ct', alias: 'ct', columns: ['owner_id', 'created_by'] }],
    // A history reader always has a person; 0 stands for "nobody" and matches no row.
    live: (o, s, a) =>
      contactOpen(
        { orgId: o, contacts: { scope: s, userId: a ?? 0 } } as unknown as Parameters<
          typeof contactOpen
        >[0],
        'ct',
      ),
    legacy: ownOrPeers(['ct.owner_id'], ['ct.owner_id']),
    creatorColumns: ['created_by'],
    unchanged: false,
  },
  {
    name: 'deals (owner_user_id; D1 adds created_by)',
    tables: [{ table: 'deals', alias: 'd', columns: ['owner_user_id', 'created_by'] }],
    live: (o, s, a) => dealScopeCondition(o, s, a),
    legacy: peersOnly('d.owner_user_id'),
    creatorColumns: ['created_by'],
    unchanged: false,
  },
  {
    name: 'crm dashboard contacts (c.owner_id; D1 adds c.created_by)',
    tables: [{ table: 'c', alias: 'c', columns: ['owner_id', 'created_by'] }],
    live: (o, s, a) => ownerScope([sql`c.owner_id`, sql`c.created_by`], o, s, a),
    legacy: peersOnly('c.owner_id'),
    creatorColumns: ['created_by'],
    unchanged: false,
  },
  {
    name: 'tasks',
    tables: [{ table: 'tasks', alias: 't', columns: ['assignee_id', 'created_by'] }],
    live: (o, s, a) => taskScopeCondition(o, s, a),
    legacy: ownOrPeers(['t.assignee_id', 't.created_by'], ['t.assignee_id', 't.created_by']),
    unchanged: true,
  },
  {
    name: 'companies',
    tables: [{ table: 'companies', alias: 'c', columns: ['owner_id', 'created_by'] }],
    live: (o, s, a) => companyScopeCondition(o, s, a),
    legacy: ownOrPeers(['c.owner_id', 'c.created_by'], ['c.owner_id', 'c.created_by']),
    unchanged: true,
  },
  {
    name: 'invoices',
    tables: [{ table: 'invoices', alias: 'i', columns: ['owner_id', 'user_id'] }],
    live: (o, s, a) => invoiceScopeCondition(o, s, a),
    legacy: ownOrPeers(['i.owner_id', 'i.user_id'], ['i.owner_id', 'i.user_id']),
    unchanged: true,
  },
  {
    name: 'credit notes',
    tables: [{ table: 'invoices', alias: 'i', columns: ['owner_id', 'user_id'] }],
    live: (o, s, a) => creditNoteScopeCondition(o, s, a),
    legacy: ownOrPeers(['i.owner_id', 'i.user_id'], ['i.owner_id', 'i.user_id']),
    unchanged: true,
  },
  {
    // The old team scope looked at the invoice's people only; a teammate who recorded a payment now counts like any other
    // creator (the one deliberate widening of BL-380, see the PR).
    name: 'payments (invoice people; recorded_by is the creator)',
    tables: [
      { table: 'invoices', alias: 'i', columns: ['owner_id', 'user_id'] },
      { table: 'payments', alias: 'p', columns: ['recorded_by'] },
    ],
    live: (o, s, a) => paymentScopeCondition(o, s, a),
    legacy: (o, s, a) => {
      if (s === 'all') return undefined;
      if (!a) return sql`false`;
      const own = sql.raw(`(i.owner_id = ${a} OR i.user_id = ${a} OR p.recorded_by = ${a})`);
      if (s === 'own') return own;
      const p = peers(o, a);
      return sql`(${own} OR i.owner_id IN ${p} OR i.user_id IN ${p})`;
    },
    creatorColumns: ['recorded_by'],
    unchanged: false,
  },
  {
    name: 'recurring invoices',
    tables: [{ table: 'recurring', alias: 'r', columns: ['owner_id', 'created_by'] }],
    live: (o, s, a) => recurringScopeCondition(o, s, a),
    legacy: ownOrPeers(['r.owner_id', 'r.created_by'], ['r.owner_id', 'r.created_by']),
    unchanged: true,
  },
  {
    name: 'sales orders',
    tables: [{ table: 'orders', alias: 'o', columns: ['owner_id', 'created_by'] }],
    live: (o, s, a) => orderScopeCondition(o, s, a),
    legacy: ownOrPeers(['o.owner_id', 'o.created_by'], ['o.owner_id', 'o.created_by']),
    unchanged: true,
  },
  {
    name: 'sales documents',
    tables: [{ table: 'docs', alias: 'd', columns: ['owner_id', 'created_by'] }],
    live: (o, s, a) => salesDocScopeCondition(o, s, a),
    legacy: ownOrPeers(['d.owner_id', 'd.created_by'], ['d.owner_id', 'd.created_by']),
    unchanged: true,
  },
  {
    name: 'forms (created_by only)',
    tables: [{ table: 'forms', alias: 'f', columns: ['created_by'] }],
    live: (o, s, a) => formScopeCondition(o, s, a),
    legacy: ownOrPeers(['f.created_by'], ['f.created_by']),
    unchanged: true,
  },
  {
    name: 'form submissions (form creator or contact owner)',
    tables: [
      { table: 'forms', alias: 'f', columns: ['created_by'] },
      { table: 'contacts', alias: 'c', columns: ['owner_id'] },
    ],
    live: (o, s, a) => submissionScopeCondition(o, s, a),
    legacy: ownOrPeers(['f.created_by', 'c.owner_id'], ['f.created_by', 'c.owner_id']),
    unchanged: true,
  },
  {
    name: 'appointments (host or booker)',
    tables: [{ table: 'appointments', alias: 'a', columns: ['user_id', 'created_by'] }],
    live: (o, s, a) => appointmentScopeCondition(o, s, a),
    legacy: ownOrPeers(['a.user_id', 'a.created_by'], ['a.user_id', 'a.created_by']),
    unchanged: true,
  },
  {
    name: 'call logs (handler)',
    tables: [{ table: 'w', alias: 'w', columns: ['handler_user_id'] }],
    live: (o, s, a) =>
      scopeClause({ orgId: o, userId: a, scope: s } as unknown as Parameters<
        typeof scopeClause
      >[0]),
    legacy: ownOrPeers(['w.handler_user_id'], ['w.handler_user_id']),
    unchanged: true,
  },
];

const USERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
type U = (typeof USERS)[number];
/** Team membership of the fixture: A,B team 1; C team 2; D teams 1+2; E none; F team 3; G team 4. */
const TEAMS: Record<U, number[]> = { A: [1], B: [1], C: [2], D: [1, 2], E: [], F: [3], G: [4] };
/** The hierarchy of the fixture (BL-382): team 3 sits under team 1, team 4 under team 3. Teams 1 and 2 are tops. */
const PARENT: Record<number, number | null> = { 1: null, 2: null, 3: 1, 4: 3 };
/** Teams a person reaches at `team_and_below`: their own and every team below, by walking PARENT. */
const reach = (teams: number[]): Set<number> => {
  const out = new Set(teams);
  for (let grew = true; grew;) {
    grew = false;
    for (const [t, p] of Object.entries(PARENT)) {
      if (p !== null && out.has(p) && !out.has(Number(t))) {
        out.add(Number(t));
        grew = true;
      }
    }
  }
  return out;
};

describe('BL-380 scope characterization (every module, real Postgres)', () => {
  let pg: TestPg;
  let orgId: number;
  const ids = {} as Record<U, number>;
  const idToName = new Map<number, U>();
  const dialect = new PgDialect();

  beforeAll(async () => {
    pg = await startTestPg();
    const one = async (q: string, p: unknown[] = []) =>
      Number((await pg.owner.query(q, p)).rows[0].id);
    orgId = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('scp','S','starter') RETURNING id`,
    );
    for (const u of USERS) {
      ids[u] = await one(
        `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,$2,$3,'x') RETURNING id`,
        [orgId, `${u.toLowerCase()}@scope.test`, u],
      );
      idToName.set(ids[u], u);
    }
    const teamIds: Record<number, number> = {};
    for (const t of [1, 2, 3, 4]) {
      teamIds[t] = await one(`INSERT INTO teams (org_id, name) VALUES ($1,$2) RETURNING id`, [
        orgId,
        `T${t}`,
      ]);
    }
    for (const [t, p] of Object.entries(PARENT)) {
      if (p !== null) {
        await pg.owner.query(`UPDATE teams SET parent_team_id = $1 WHERE org_id = $2 AND id = $3`, [
          teamIds[p],
          orgId,
          teamIds[Number(t)],
        ]);
      }
    }
    for (const u of USERS) {
      for (const t of TEAMS[u]) {
        await pg.owner.query(
          `INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`,
          [orgId, teamIds[t], ids[u]],
        );
      }
    }
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  /** Does a person in `values` see the record under the rule written out in TypeScript. */
  const visible = (scope: RecordScope, actor: U | null, values: Array<U | null>): boolean => {
    if (scope === 'all') return true;
    if (actor === null) return false;
    if (scope === 'own') return values.includes(actor);
    const mine = scope === 'team_and_below' ? reach(TEAMS[actor]) : new Set(TEAMS[actor]);
    return values.some((v) => v !== null && (v === actor || TEAMS[v].some((t) => mine.has(t))));
  };

  async function rowsOf(
    probe: Probe,
    rowsByTable: Map<string, string>,
    cond: SQL | undefined | null,
  ): Promise<Set<number>> {
    const [first, ...rest] = probe.tables;
    const from =
      `FROM ${rowsByTable.get(first!.table + first!.alias)} ${first!.alias ? `AS ${first!.alias}` : ''} ` +
      rest
        .map(
          (t) =>
            `JOIN ${rowsByTable.get(t.table + t.alias)} AS ${t.alias} ON ${t.alias}.id = ${first!.alias || first!.table}.id`,
        )
        .join(' ');
    const where = cond ? dialect.sqlToQuery(cond) : { sql: 'true', params: [] as unknown[] };
    const res = await pg.owner.query(
      `SELECT ${first!.alias || first!.table}.id AS id ${from} WHERE ${where.sql}`,
      where.params,
    );
    return new Set(res.rows.map((r: { id: string | number }) => Number(r.id)));
  }

  for (const probe of PROBES) {
    it(`${probe.name}: live = model for every actor and scope; legacy kept or widened only as documented`, async () => {
      // Build the probe tables: one row per combination of the person values, same id across the joined tables.
      const cols = probe.tables.flatMap((t) => t.columns.map((c) => ({ t, c })));
      const options: Array<U | null> = [null, ...USERS];
      const combos: Array<Array<U | null>> = [[]];
      for (let i = 0; i < cols.length; i++) {
        const next: Array<Array<U | null>> = [];
        for (const c of combos) for (const o of options) next.push([...c, o]);
        combos.splice(0, combos.length, ...next);
      }
      const tableNames = new Map<string, string>();
      for (const [ti, t] of probe.tables.entries()) {
        // The condition may name the table itself (contacts) or its alias; the physical name is a temp table of that name.
        const physical =
          t.alias === ''
            ? t.table
            : `${t.table}_${probe.name.replace(/\W+/g, '_').slice(0, 20)}_${ti}`;
        tableNames.set(t.table + t.alias, physical);
        await pg.owner.query(`DROP TABLE IF EXISTS pg_temp.${physical}`);
        await pg.owner.query(
          `CREATE TEMP TABLE ${physical} (id int PRIMARY KEY, ${t.columns.map((c) => `${c} bigint`).join(', ')})`,
        );
      }
      for (const [n, combo] of combos.entries()) {
        let k = 0;
        for (const t of probe.tables) {
          const physical = tableNames.get(t.table + t.alias)!;
          const vals = t.columns.map(() => {
            const u = combo[k++]!;
            return u === null ? null : ids[u];
          });
          await pg.owner.query(
            `INSERT INTO ${physical} (id, ${t.columns.join(', ')}) VALUES ($1, ${t.columns.map((_, i) => `$${i + 2}`).join(', ')})`,
            [n + 1, ...vals],
          );
        }
      }

      const valuesOf = (n: number): Array<U | null> => combos[n]!;
      const creatorIdx = new Set(
        cols.map((c, i) => (probe.creatorColumns?.includes(c.c) ? i : -1)).filter((i) => i >= 0),
      );

      for (const scope of ['own', 'team', 'team_and_below', 'all'] as RecordScope[]) {
        for (const actor of [...USERS, null] as Array<U | null>) {
          const actorId = actor === null ? null : ids[actor];
          const live = await rowsOf(probe, tableNames, probe.live(orgId, scope, actorId));
          const model = new Set(
            combos.map((_, n) => n + 1).filter((id) => visible(scope, actor, valuesOf(id - 1))),
          );
          expect(
            [...live].sort((a, b) => a - b),
            `${probe.name} ${scope} as ${actor}: live vs model`,
          ).toEqual([...model].sort((a, b) => a - b));

          // `team_and_below` is new (BL-382): there is no old SQL to compare it with, only the model above.
          if (!probe.legacy || scope === 'team_and_below') continue;
          const old = await rowsOf(probe, tableNames, probe.legacy(orgId, scope, actorId));
          if (probe.unchanged) {
            expect(
              [...live].sort((a, b) => a - b),
              `${probe.name} ${scope} as ${actor}: live vs legacy`,
            ).toEqual([...old].sort((a, b) => a - b));
            continue;
          }
          for (const id of old)
            expect(live.has(id), `${probe.name} ${scope} as ${actor}: legacy row ${id} lost`).toBe(
              true,
            );
          for (const id of live) {
            if (old.has(id)) continue;
            const vals = valuesOf(id - 1);
            // Explained by D1: a creator column is me (own) or me / a teammate (team) ...
            const byCreator = [...creatorIdx].some((i) => visible(scope, actor, [vals[i] ?? null]));
            // ... or the old team scope hid my own record because I am in no team.
            const byNoTeam = scope === 'team' && actor !== null && vals.includes(actor);
            expect(
              byCreator || byNoTeam,
              `${probe.name} ${scope} as ${actor}: row ${id} widened without a documented reason`,
            ).toBe(true);
          }
        }
      }
    }, 120_000);
  }
});
