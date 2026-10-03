import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { VariableBag } from './variables';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const blank = (v: unknown): boolean => v === undefined || v === null || String(v).trim() === '';

interface ContactRow {
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  title: string | null;
  language: string | null;
  data: Record<string, unknown> | null;
}

/**
 * The variables a run starts with (TW-FLR-014 rule 3). Reference's Node process never read the contact: Laravel passed a few fields in
 * the start call. Here the engine reads it, so a run started from a keyword and one started by enrollment see the same contact.
 *
 * Order, last wins: the workspace's attribute defaults, then the contact's own fields and attribute values (a blank contact value
 * never overwrites a default), then what the caller passed (an order's number, a webhook lead's fields). `user_message` is the typed
 * text on a keyword start and is not set otherwise.
 */
export async function seedVariables(
  tx: Tx,
  orgId: number,
  contactId: number | null,
  peerKey: string,
  extra: {
    userMessage?: string | null;
    pushName?: string | null;
    variables?: Record<string, unknown>;
  },
): Promise<VariableBag> {
  const bag: VariableBag = {};

  const defaults = await tx.execute(sql`
    SELECT key, config->>'defaultValue' AS value FROM fields
    WHERE org_id = ${orgId} AND module_key = 'contacts' AND NOT is_system AND is_active`);
  for (const r of (defaults as unknown as { rows: Array<{ key: string; value: string | null }> })
    .rows) {
    if (!blank(r.value)) bag[r.key] = r.value;
  }

  let c: ContactRow | undefined;
  if (contactId !== null) {
    const res = await tx.execute(sql`
      SELECT name, first_name, last_name, phone, email::text AS email, address, title, language, data
      FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`);
    c = (res as unknown as { rows: ContactRow[] }).rows[0];
  }
  const first =
    c?.first_name || (c?.name ? c.name.trim().split(/\s+/)[0] : '') || extra.pushName || '';
  const name = c?.name || extra.pushName || '';
  const set = (k: string, v: unknown) => {
    if (!blank(v)) bag[k] = v;
  };
  set('name', name);
  set('first_name', first);
  set('last_name', c?.last_name);
  set('mobile', peerKey);
  set('phone', peerKey);
  set('email', c?.email);
  set('address', c?.address);
  set('title', c?.title);
  set('language', c?.language);
  for (const [k, v] of Object.entries(c?.data ?? {})) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      if (!(k in bag) || !blank(v)) set(k, v);
    }
  }
  if (!blank(extra.userMessage)) bag['user_message'] = str(extra.userMessage);
  for (const [k, v] of Object.entries(extra.variables ?? {})) {
    if (!blank(v)) bag[k] = v;
  }
  return bag;
}
