import { sql, withPrivileged, type Database } from './db';

/**
 * The workspace settings Waboo keeps and the app has a home for, read by pilot/staging/core-opening.cjs into core.json (`settings`,
 * `workspace.autoAssignment`): the deal pipelines with their stages, the lost reasons, the opt-in / opt-out keyword rows and the
 * auto-assignment switch. Applied once by `core-load`; a re-run changes nothing (the loader never overwrites what a person edited later).
 */
export interface WabooSettings {
  pipelines?: Array<{
    id?: string;
    name?: string;
    stages?: Array<{ id?: string; name?: string; probability?: number }>;
  }>;
  lostReasons?: Array<{ id?: string; reason?: string }>;
  consent?: Array<{
    type?: string;
    channel?: string;
    status?: string;
    keywords?: string[];
    response?: string | null;
  }>;
  /** contact_task_config action "task_outcomes": the options of the Task outcomes settings list */
  taskOutcomes?: Array<{
    label?: string;
    name?: string;
    position?: number | null;
    visible?: boolean;
    at?: number;
  }>;
  /** newest successful login per Waboo user id (auth_logs, type "login"): only the time, no address and no device */
  lastLogins?: Array<{ userId?: string; at?: string }>;
}

export interface StageRow {
  name: string;
  sortOrder: number;
  color: string;
  isWon: boolean;
  isLost: boolean;
  probability: number;
}

const OPEN_COLORS = [
  '#64748B',
  '#0EA5E9',
  '#6366F1',
  '#F59E0B',
  '#A855F7',
  '#14B8A6',
  '#EC4899',
  '#84CC16',
];
const WON = '#16A34A';
const LOST = '#DC2626';

const clean = (v: unknown, max: number): string =>
  String(v ?? '')
    .trim()
    .slice(0, max);

/**
 * Pure: the stages a Waboo pipeline becomes. Open stages keep their order and win probability; the stage at 100% is the Won stage; the app
 * requires exactly one Won and one Lost stage, open ones first, so a Won (100%) and a Lost (0%) are added when Waboo has none. Waboo's stage
 * names are kept as they are.
 */
export function stagesOf(
  stages: Array<{ name?: string; probability?: number }> | undefined,
): StageRow[] {
  const src = (stages ?? [])
    .map((s) => ({
      name: clean(s.name, 120),
      p: Math.min(100, Math.max(0, Math.round(Number(s.probability) || 0))),
    }))
    .filter((s) => s.name !== '');
  const wonAt = src.findIndex((s) => s.p === 100);
  const lostAt = src.findIndex((s, i) => i !== wonAt && s.p === 0 && /\blost\b/i.test(s.name));
  const open = src
    .filter((_, i) => i !== wonAt && i !== lostAt)
    .map((s) => ({ ...s, p: Math.min(s.p, 99) }));
  const rows: StageRow[] = open.map((s, i) => ({
    name: s.name,
    sortOrder: i,
    color: OPEN_COLORS[i % OPEN_COLORS.length]!,
    isWon: false,
    isLost: false,
    probability: s.p,
  }));
  rows.push({
    name: wonAt >= 0 ? src[wonAt]!.name : 'Won',
    sortOrder: rows.length,
    color: WON,
    isWon: true,
    isLost: false,
    probability: 100,
  });
  rows.push({
    name: lostAt >= 0 ? src[lostAt]!.name : 'Lost',
    sortOrder: rows.length,
    color: LOST,
    isWon: false,
    isLost: true,
    probability: 0,
  });
  return rows;
}

/**
 * Pure: the consent settings the opt-in / opt-out rows give. Keywords and reply texts replace the app's defaults (the workspace behaves as
 * it did in Waboo); the auto-reply switch is on only when BOTH rows were active (the app has one switch for both replies). Null when the
 * workspace has neither row.
 */
export function consentOf(rows: WabooSettings['consent']): {
  autoReply: boolean;
  config: Record<string, Record<string, unknown>>;
  note: string | null;
} | null {
  const live = (rows ?? []).filter((r) => r.type === 'opt-in' || r.type === 'opt-out');
  if (live.length === 0) return null;
  const lang = 'en';
  const words = (t: string): string[] => [
    ...new Set(
      live
        .filter((r) => r.type === t)
        .flatMap((r) => r.keywords ?? [])
        .map((k) => clean(k, 40))
        .filter(Boolean),
    ),
  ];
  const text = (t: string): string | null =>
    clean(live.find((r) => r.type === t && r.response)?.response, 600) || null;
  const config: Record<string, Record<string, unknown>> = {};
  if (words('opt-out').length) config.optOutKeywords = { [lang]: words('opt-out') };
  if (words('opt-in').length) config.optInKeywords = { [lang]: words('opt-in') };
  if (text('opt-out')) config.optOutReply = { [lang]: text('opt-out') };
  if (text('opt-in')) config.optInReply = { [lang]: text('opt-in') };
  const active = (t: string): boolean =>
    live.some((r) => r.type === t && String(r.status).toLowerCase() === 'active');
  const autoReply = active('opt-in') && active('opt-out');
  const note =
    active('opt-in') !== active('opt-out')
      ? 'only one of the two Waboo responses was active; the app has one switch for both, so auto-replies stay off'
      : null;
  return { autoReply, config, note };
}

export interface OutcomeRow {
  name: string;
  sortOrder: number;
  isActive: boolean;
}

/**
 * Pure: the task outcomes Waboo lists. The label is the name (the typo "No responsed" stays), the first of two names that differ only in
 * case wins, the order is the position the source gives (else its place in the list), renumbered 0..n-1, and an entry Waboo hides
 * (visible false) is loaded as inactive: it is no longer offered but is still there, as in Waboo.
 */
export function outcomesOf(list: WabooSettings['taskOutcomes']): OutcomeRow[] {
  const seen = new Set<string>();
  return (list ?? [])
    .map((o, i) => ({
      name: clean(o.label ?? o.name, 191),
      pos: typeof o.position === 'number' ? o.position : i,
      i,
      active: o.visible !== false,
    }))
    .filter(
      (o) => o.name !== '' && !seen.has(o.name.toLowerCase()) && seen.add(o.name.toLowerCase()),
    )
    .sort((a, b) => a.pos - b.pos || a.i - b.i)
    .map((o, n) => ({ name: o.name, sortOrder: n, isActive: o.active }));
}

export interface SettingsPlan {
  taskOutcomes: OutcomeRow[];
  /** the source's task-outcome list was read (it may be empty): only then are the defaults a new workspace is seeded with removed */
  taskOutcomesKnown: boolean;
  lastLogins: Array<{ userId: string; at: string }>;
  pipelines: Array<{ name: string; stages: StageRow[] }>;
  lostReasons: string[];
  consent: ReturnType<typeof consentOf>;
  autoAssign: boolean;
}

export function planSettings(
  settings: WabooSettings | undefined,
  autoAssignment: boolean | undefined,
): SettingsPlan {
  const names = new Set<string>();
  const pipelines = (settings?.pipelines ?? [])
    .map((p) => ({ name: clean(p.name, 120), stages: stagesOf(p.stages) }))
    .filter(
      (p) => p.name !== '' && !names.has(p.name.toLowerCase()) && names.add(p.name.toLowerCase()),
    );
  const seen = new Set<string>();
  const lostReasons = (settings?.lostReasons ?? [])
    .map((r) => clean(r.reason, 191))
    .filter((r) => r !== '' && !seen.has(r.toLowerCase()) && seen.add(r.toLowerCase()));
  const lastLogins = (settings?.lastLogins ?? []).flatMap((l) => {
    const at = l.at ? new Date(l.at) : null;
    return l.userId && at && !Number.isNaN(at.getTime())
      ? [{ userId: String(l.userId), at: at.toISOString() }]
      : [];
  });
  return {
    pipelines,
    lostReasons,
    consent: consentOf(settings?.consent),
    autoAssign: autoAssignment === true,
    taskOutcomes: outcomesOf(settings?.taskOutcomes),
    taskOutcomesKnown: Array.isArray(settings?.taskOutcomes),
    lastLogins,
  };
}

/** What `apply` did, for the log and for the verifier. */
export interface SettingsResult {
  pipelinesCreated: string[];
  pipelinesReplaced: string[];
  pipelinesKept: string[];
  lostReasons: number;
  taskOutcomes: number;
  lastLogins: number;
  consent: boolean;
  routingRule: 'created' | 'exists' | 'no-agents' | 'off';
}

/** Writes the plan for one organization (owner connection, one transaction). Never overwrites what a person already has in use. */
export async function applySettings(
  ownerDb: Database,
  orgId: number,
  plan: SettingsPlan,
): Promise<SettingsResult> {
  return withPrivileged(ownerDb, async (tx) => {
    const res: SettingsResult = {
      pipelinesCreated: [],
      pipelinesReplaced: [],
      pipelinesKept: [],
      lostReasons: 0,
      taskOutcomes: 0,
      lastLogins: 0,
      consent: false,
      routingRule: 'off',
    };
    const currency = String(
      (
        (
          await tx.execute(
            sql`SELECT currency FROM pipelines WHERE org_id = ${orgId} AND is_default LIMIT 1`,
          )
        ).rows[0] as { currency?: string } | undefined
      )?.currency ?? 'INR',
    );
    let order = 0;
    for (const p of plan.pipelines) {
      order++;
      const have = (
        await tx.execute(
          sql`SELECT id FROM pipelines WHERE org_id = ${orgId} AND lower(name) = lower(${p.name}) ORDER BY id LIMIT 1`,
        )
      ).rows[0] as { id: number | string } | undefined;
      let pid: number;
      if (have) {
        pid = Number(have.id);
        const deals = Number(
          (
            (
              await tx.execute(
                sql`SELECT count(*)::int AS n FROM deals WHERE org_id = ${orgId} AND pipeline_id = ${pid}`,
              )
            ).rows[0] as { n: number }
          ).n,
        );
        if (deals > 0) {
          res.pipelinesKept.push(p.name);
          continue;
        }
        // the default pipeline the app seeded: same name, no deals in it: its stages become Waboo's
        await tx.execute(
          sql`DELETE FROM pipeline_stages WHERE org_id = ${orgId} AND pipeline_id = ${pid}`,
        );
        res.pipelinesReplaced.push(p.name);
      } else {
        const ins = await tx.execute(sql`
          INSERT INTO pipelines (org_id, name, is_default, currency, sort_order) VALUES (${orgId}, ${p.name}, false, ${currency}, ${order})
          RETURNING id`);
        pid = Number((ins.rows[0] as { id: number | string }).id);
        res.pipelinesCreated.push(p.name);
      }
      for (const s of p.stages)
        await tx.execute(sql`
          INSERT INTO pipeline_stages (org_id, pipeline_id, name, sort_order, color, is_won, is_lost, probability)
          VALUES (${orgId}, ${pid}, ${s.name}, ${s.sortOrder}, ${s.color}, ${s.isWon}, ${s.isLost}, ${s.probability})`);
    }

    let pos = 0;
    for (const reason of plan.lostReasons) {
      const r = await tx.execute(sql`
        INSERT INTO deal_lost_reasons (org_id, name, sort_order) VALUES (${orgId}, ${reason}, ${pos++})
        ON CONFLICT DO NOTHING RETURNING 1`);
      res.lostReasons += r.rows.length;
    }

    if (plan.taskOutcomesKnown) {
      // a new workspace is seeded with default outcomes (Interested ... Not interested ...): the Waboo list replaces them, but an outcome a task uses stays
      await tx.execute(sql`
        DELETE FROM task_outcomes o
        WHERE o.org_id = ${orgId}
          AND lower(btrim(o.name)) NOT IN (SELECT lower(btrim(x)) FROM jsonb_array_elements_text(${JSON.stringify(plan.taskOutcomes.map((t) => t.name))}::jsonb) AS x)
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.org_id = o.org_id AND t.outcome_id = o.id)`);
    }
    for (const o of plan.taskOutcomes) {
      const r = await tx.execute(sql`
        INSERT INTO task_outcomes (org_id, name, sort_order, is_active) VALUES (${orgId}, ${o.name}, ${o.sortOrder}, ${o.isActive})
        ON CONFLICT (org_id, lower(btrim(name))) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, is_active = EXCLUDED.is_active
        RETURNING 1`);
      res.taskOutcomes += r.rows.length;
    }

    // the time each member last signed in to Waboo; never moves a later value (a sign-in to Desk) back
    for (const l of plan.lastLogins) {
      const r = await tx.execute(sql`
        UPDATE user_security s SET last_login_at = GREATEST(s.last_login_at, ${l.at}::timestamptz)
        FROM users u
        WHERE u.org_id = ${orgId} AND s.org_id = u.org_id AND s.user_id = u.id
          AND u.settings #>> '{legacy,waboo,sourceUserId}' = ${l.userId}
        RETURNING 1`);
      res.lastLogins += r.rows.length;
    }

    if (plan.consent) {
      const r = await tx.execute(sql`
        INSERT INTO contact_consent_settings (org_id, auto_reply_enabled, config)
        VALUES (${orgId}, ${plan.consent.autoReply}, ${JSON.stringify(plan.consent.config)}::jsonb)
        ON CONFLICT (org_id) DO NOTHING RETURNING 1`);
      res.consent = r.rows.length > 0;
    }

    if (plan.autoAssign) {
      const exists = await tx.execute(
        sql`SELECT 1 FROM routing_rules WHERE org_id = ${orgId} AND is_fallback LIMIT 1`,
      );
      if (exists.rows.length > 0) res.routingRule = 'exists';
      else {
        // Waboo: "chats are evenly distributed among agents": every migrated, active team member takes a turn
        const agents = (
          await tx.execute(sql`
            SELECT uuid::text AS uuid FROM users
            WHERE org_id = ${orgId} AND status = 'active' AND jsonb_exists(coalesce(settings -> 'legacy' -> 'waboo', '{}'::jsonb), 'sourceUserId')
            ORDER BY id`)
        ).rows as Array<{ uuid: string }>;
        if (agents.length === 0) res.routingRule = 'no-agents';
        else {
          const conditions = {
            contact: null,
            channelKinds: [],
            keywords: null,
            languages: [],
            businessHours: 'any',
          };
          const actions = [
            {
              type: 'assign',
              strategy: 'round_robin',
              userIds: agents.map((a) => a.uuid),
              teamIds: [],
              rrCursor: null,
            },
            {
              type: 'note',
              description: 'Waboo auto assignment: chats are distributed evenly among agents',
            },
          ];
          await tx.execute(sql`
            INSERT INTO routing_rules (org_id, name, conditions, actions, stop_on_match, is_active, is_fallback, sort)
            VALUES (${orgId}, 'Auto assignment (from Waboo)', ${JSON.stringify(conditions)}::jsonb, ${JSON.stringify(actions)}::jsonb, true, true, true, 1)`);
          res.routingRule = 'created';
        }
      }
    }
    return res;
  });
}
