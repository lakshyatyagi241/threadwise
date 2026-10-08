type Bag = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The WhatsApp customer-service window: a business may send free-form text for this long after the customer's last message. */
export const WA_SESSION_HOURS = 24;

/**
 * "Update contact field" (what the editor saves: `{ field, value }`). The field is a contact column key (`name`, `email`, ...) or a
 * custom property key; the value is a template over the run's variables. A step with no field is skipped, never an error.
 */
export function updateFieldConfig(
  d: Bag,
  render: (t: unknown) => string,
): { field: string; value: string } | null {
  const field = str(d.field ?? d.key)
    .trim()
    .replace(/^\{\{|\}\}$/g, '')
    .trim();
  if (field === '') return null;
  return { field, value: render(d.value) };
}

/** "Add to list" / "Remove from list" (`{ action, listId, list }`): the list by uuid or by name. */
export function listConfig(d: Bag): {
  action: 'add' | 'remove';
  groupId: string;
  name: string;
} {
  return {
    action: str(d.action).toLowerCase() === 'remove' ? 'remove' : 'add',
    groupId: str(d.listId ?? d.groupId).trim(),
    name: str(d.list ?? d.listName).trim(),
  };
}

/** "Is in segment" (`{ segmentId }`). */
export function segmentConfig(d: Bag): { segmentId: string } {
  return { segmentId: str(d.segmentId ?? d.segment).trim() };
}

/**
 * "WhatsApp active session" (`{ hours }`, default 24): the customer wrote within the last `hours`, so a free-form message can still
 * go out. A customer who never wrote has no session. The hours are clamped to a day and a month.
 */
export function sessionOpen(lastInboundAt: Date | null, hours: unknown, now: Date): boolean {
  if (!lastInboundAt) return false;
  const n = Number(hours);
  const h = Number.isFinite(n) && n > 0 ? Math.min(Math.max(n, 1), 720) : WA_SESSION_HOURS;
  return now.getTime() - lastInboundAt.getTime() < h * 3_600_000;
}
