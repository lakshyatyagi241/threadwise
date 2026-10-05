import { sql } from 'drizzle-orm';

/**
 * Where an order stands on money, as one SQL expression so the order list, the payments overview and their filters can never
 * disagree (`o` is `wa_orders`). `paid`: the status says so, a gateway or WhatsApp Pay confirmed it, or a webhook stamped how it
 * arrived. `cod`: cash on delivery, not paid yet. `awaiting`: a payment link was issued. `unpaid`: nothing asked for yet.
 */
export const PAYMENT_STATUS_SQL = sql`(CASE
  WHEN o.status = 'paid'
    OR lower(coalesce(o.wa_payment_status, '')) IN ('captured', 'paid', 'success', 'completed')
    OR coalesce(o.meta_json ->> 'paid_via', '') <> '' THEN 'paid'
  WHEN o.payment_method = 'cod' THEN 'cod'
  WHEN coalesce(o.payment_link, '') <> '' THEN 'awaiting'
  ELSE 'unpaid' END)`;

/** `to_char` format of a timestamptz with its full microseconds: the cursor compares this, a JS Date would drop them. */
export const ISO_MICROS = `YYYY-MM-DD"T"HH24:MI:SS.US"Z"`;
