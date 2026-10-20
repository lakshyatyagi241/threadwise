type Entry = Record<string, unknown>;

const isEntry = (v: unknown): v is Entry =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * A routing rule keeps its actions as a list of typed entries (`{ type: 'assign', strategy, userIds, teamIds, rrCursor }`,
 * `{ type: 'mark_spam' }`, ...), written by the routing module. Read here only as JSON: the teams module may not import another
 * module's internals, and the one thing it needs is which team uuids an `assign` entry names.
 */
export function routingActionsNameTeam(actions: unknown, teamUuid: string): boolean {
  return list(actions).some(
    (a) => isEntry(a) && a.type === 'assign' && list(a.teamIds).includes(teamUuid),
  );
}

/** Entry types that make a rule do something when it fires (a `note` is a description, not an action). */
const DOES_SOMETHING = new Set([
  'assign',
  'mark_spam',
  'set_priority',
  'add_tag',
  'auto_reply',
  'set_escalation',
  'trigger_flow',
]);

/**
 * A routing rule's stored actions once a deleted team is no longer a target (BL-380, gap 14).
 *
 * The team leaves the `assign` entry. A rule whose only target was that team keeps its other actions (spam, priority, tags, flow, auto
 * reply) and loses the assignment; a deferred reassignment that depended on the assignment is dropped with it (its priority, if it has
 * one, stays). A rule left with nothing to do is switched off rather than deleted, so the person can see it and decide.
 */
export function withoutTeam(
  actions: unknown,
  teamUuid: string,
): { actions: Entry[]; deactivate: boolean } {
  let out = list(actions).filter(isEntry);
  let assignGone = false;
  out = out.flatMap((a) => {
    if (a.type !== 'assign') return [a];
    const teamIds = list(a.teamIds).filter((t) => t !== teamUuid);
    if (list(a.userIds).length + teamIds.length === 0) {
      assignGone = true;
      return [];
    }
    return [{ ...a, teamIds }];
  });
  if (assignGone) {
    out = out.flatMap((a) => {
      if (a.type !== 'set_escalation' || a.reassign !== true) return [a];
      return a.priority == null ? [] : [{ ...a, reassign: false }];
    });
  }
  return { actions: out, deactivate: !out.some((a) => DOES_SOMETHING.has(String(a.type))) };
}
