import {
  routingAssignSchema,
  routingAutoReplySchema,
  routingConditionsSchema,
  routingEscalationSchema,
  routingTagSchema,
  type ConversationPriority,
  type RoutingAssign,
  type RoutingAutoReply,
  type RoutingConditions,
  type RoutingEscalation,
  type RoutingRule,
  type RoutingTag,
  type RoutingTriggerFlow,
} from '@crm/contracts';

type Raw = Record<string, unknown>;

/** `routing_rules.actions`, as stored: Reference's list of action dicts. The assign action carries the private round robin cursor. */
export interface StoredActions {
  /** Null when the rule has no assignment (it only marks spam or starts a flow). */
  assign: RoutingAssign | null;
  /** Whether the rule marks the conversation as spam when it fires. */
  markSpam: boolean;
  /** The priority the rule sets when it fires, or none. */
  priority: ConversationPriority | null;
  /** The tags the rule adds when it fires. */
  addTags: RoutingTag[];
  /** The deferred reassignment or priority the rule schedules when it fires, or none. */
  escalation: RoutingEscalation | null;
  /** The automatic reply the rule sends, or none. */
  autoReply: RoutingAutoReply | null;
  /** The uuid of the flow to start for the conversation when the rule fires, or none. */
  triggerFlowId: string | null;
  description: string;
  /** Internal id of the user who got this rule's last conversation. Never sent to a client. */
  cursor: number | null;
}

export function encodeActions(a: StoredActions): unknown[] {
  const out: unknown[] = [];
  if (a.assign) out.push({ type: 'assign', ...a.assign, rrCursor: a.cursor });
  if (a.markSpam) out.push({ type: 'mark_spam' });
  if (a.priority) out.push({ type: 'set_priority', priority: a.priority });
  for (const t of a.addTags) out.push({ type: 'add_tag', name: t.name, color: t.color });
  if (a.autoReply) out.push({ type: 'auto_reply', body: a.autoReply.body });
  if (a.escalation)
    out.push({
      type: 'set_escalation',
      minutes: a.escalation.minutes,
      reassign: a.escalation.reassign,
      priority: a.escalation.priority,
    });
  if (a.triggerFlowId) out.push({ type: 'trigger_flow', flowId: a.triggerFlowId });
  if (a.description) out.push({ type: 'note', description: a.description });
  return out;
}

function autoReplyOf(list: Raw[]): RoutingAutoReply | null {
  const r = list.find((x) => x?.type === 'auto_reply');
  if (!r) return null;
  const parsed = routingAutoReplySchema.safeParse({ body: r.body });
  return parsed.success ? parsed.data : null;
}

function escalationOf(list: Raw[]): RoutingEscalation | null {
  const e = list.find((x) => x?.type === 'set_escalation');
  if (!e) return null;
  const parsed = routingEscalationSchema.safeParse({
    minutes: e.minutes,
    reassign: e.reassign === true,
    priority: e.priority ?? null,
  });
  return parsed.success ? parsed.data : null;
}

function priorityOf(list: Raw[]): ConversationPriority | null {
  const p = list.find((x) => x?.type === 'set_priority')?.priority;
  return p === 'low' || p === 'normal' || p === 'high' || p === 'urgent' ? p : null;
}

/** Reads what was stored; anything that does not parse (a hand-edited row) becomes no assignment, which does nothing. */
export function decodeActions(raw: unknown): StoredActions {
  const list = Array.isArray(raw) ? (raw as Raw[]) : [];
  const a = list.find((x) => x?.type === 'assign');
  const note = list.find((x) => x?.type === 'note');
  const trigger = list.find((x) => x?.type === 'trigger_flow');
  const parsed = a
    ? routingAssignSchema.safeParse({
        strategy: a.strategy,
        userIds: a.userIds,
        teamIds: a.teamIds,
        everyone: a.everyone === true,
      })
    : null;
  const cursor = a && typeof a.rrCursor === 'number' ? a.rrCursor : null;
  return {
    assign: parsed?.success ? parsed.data : null,
    markSpam: list.some((x) => x?.type === 'mark_spam'),
    priority: priorityOf(list),
    escalation: escalationOf(list),
    autoReply: autoReplyOf(list),
    addTags: list.flatMap((x) => {
      if (x?.type !== 'add_tag') return [];
      const tag = routingTagSchema.safeParse({ name: x.name, color: x.color ?? null });
      return tag.success ? [tag.data] : [];
    }),
    triggerFlowId: typeof trigger?.flowId === 'string' ? trigger.flowId : null,
    description: typeof note?.description === 'string' ? note.description : '',
    cursor,
  };
}

export function decodeConditions(raw: unknown): RoutingConditions {
  const parsed = routingConditionsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : routingConditionsSchema.parse({});
}

/** The flow a rule starts, as shown: a flow that no longer exists keeps its id (so it can be cleared) with no name and switched off. */
function triggerFlowOf(
  id: string | null,
  flows: ReadonlyMap<string, { name: string; isActive: boolean }>,
): RoutingTriggerFlow | null {
  if (!id) return null;
  const f = flows.get(id);
  return { id, name: f?.name ?? null, isActive: f?.isActive ?? false };
}

const iso = (v: unknown): string => new Date(v as string | Date).toISOString();

/** One `routing_rules` row (plus `position`) as the API returns it. `unavailable` is how many targets can no longer take a conversation. */
export function toRoutingRule(
  r: Raw,
  unavailable: number,
  flows: ReadonlyMap<string, { name: string; isActive: boolean }> = new Map(),
): RoutingRule {
  const actions = decodeActions(r.actions);
  return {
    id: r.uuid as string,
    name: r.name as string,
    description: actions.description,
    conditions: decodeConditions(r.conditions),
    assign: actions.assign,
    markSpam: actions.markSpam,
    priority: actions.priority,
    addTags: actions.addTags,
    escalation: actions.escalation,
    autoReply: actions.autoReply,
    triggerFlow: triggerFlowOf(actions.triggerFlowId, flows),
    stopOnMatch: r.stop_on_match === true,
    isActive: r.is_active === true,
    isFallback: r.is_fallback === true,
    appliesToAll: r.applies_to_all === true,
    position: Number(r.position),
    firedCount: Number(r.fired_count),
    lastFiredAt: r.last_fired_at ? iso(r.last_fired_at) : null,
    unavailableTargets: unavailable,
    rowVersion: Number(r.row_version),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
