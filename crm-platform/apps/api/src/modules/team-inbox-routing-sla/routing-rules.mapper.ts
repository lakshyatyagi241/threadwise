import {
  routingAssignSchema,
  routingConditionsSchema,
  type RoutingAssign,
  type RoutingConditions,
  type RoutingRule,
} from '@crm/contracts';

type Raw = Record<string, unknown>;

/** `routing_rules.actions`, as stored: Reference's list of action dicts. The assign action carries the private round robin cursor. */
export interface StoredActions {
  assign: RoutingAssign;
  description: string;
  /** Internal id of the user who got this rule's last conversation. Never sent to a client. */
  cursor: number | null;
}

export function encodeActions(a: StoredActions): unknown[] {
  const out: unknown[] = [{ type: 'assign', ...a.assign, rrCursor: a.cursor }];
  if (a.description) out.push({ type: 'note', description: a.description });
  return out;
}

const EMPTY_ASSIGN: RoutingAssign = { strategy: 'round_robin', userIds: [], teamIds: [] };

/** Reads what was stored; anything that does not parse (a hand-edited row) becomes an empty assign that does nothing. */
export function decodeActions(raw: unknown): StoredActions {
  const list = Array.isArray(raw) ? (raw as Raw[]) : [];
  const a = list.find((x) => x?.type === 'assign');
  const note = list.find((x) => x?.type === 'note');
  const parsed = a
    ? routingAssignSchema.safeParse({
        strategy: a.strategy,
        userIds: a.userIds,
        teamIds: a.teamIds,
      })
    : null;
  const cursor = a && typeof a.rrCursor === 'number' ? a.rrCursor : null;
  return {
    assign: parsed?.success ? parsed.data : EMPTY_ASSIGN,
    description: typeof note?.description === 'string' ? note.description : '',
    cursor,
  };
}

export function decodeConditions(raw: unknown): RoutingConditions {
  const parsed = routingConditionsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : routingConditionsSchema.parse({});
}

const iso = (v: unknown): string => new Date(v as string | Date).toISOString();

/** One `routing_rules` row (plus `position`) as the API returns it. `unavailable` is how many targets can no longer take a conversation. */
export function toRoutingRule(r: Raw, unavailable: number): RoutingRule {
  const actions = decodeActions(r.actions);
  return {
    id: r.uuid as string,
    name: r.name as string,
    description: actions.description,
    conditions: decodeConditions(r.conditions),
    assign: actions.assign,
    stopOnMatch: r.stop_on_match === true,
    isActive: r.is_active === true,
    isFallback: r.is_fallback === true,
    position: Number(r.position),
    firedCount: Number(r.fired_count),
    lastFiredAt: r.last_fired_at ? iso(r.last_fired_at) : null,
    unavailableTargets: unavailable,
    rowVersion: Number(r.row_version),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
