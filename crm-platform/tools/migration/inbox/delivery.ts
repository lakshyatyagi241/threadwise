import { deriveStatus, errorParts } from '../broadcast/rules';
import { str, type Doc } from '../util';

/**
 * What Waboo's delivery log knows about ONE outbound message. The chat history carries no receipt: the loader writes every outbound turn
 * `sent` (so nothing is ever re-dispatched), and the receipts live in the billing log (`whatsapp_broadcasting_data`, one row per sent
 * message, keyed by the WhatsApp message id) as one date per step: sent, delivered, seen, replied, failed. The chat dumps checked carry no
 * outbound WhatsApp message id (README section 9, "Delivery state"), so this join is not usable on them yet.
 * The step rules are the broadcast recipients' (broadcast/rules.ts deriveStatus); a customer's reply is proof the message was read.
 */
export interface Receipt {
  wamid: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  deliveredAt: string | null;
  readAt: string | null;
  failureCode: string | null;
  failureReason: string | null;
}

const RANK = { sent: 0, delivered: 1, read: 2, failed: 0 } as const;

/** The receipt of one billing-log document; null when it has no message id or no readable step. */
export function receiptOf(doc: Doc): Receipt | null {
  const wamid = str(doc.message_id);
  if (!wamid) return null;
  const st = deriveStatus(doc);
  if (!st) return null;
  if (st.status === 'failed') {
    const e = errorParts(doc.error);
    return {
      wamid,
      status: 'failed',
      deliveredAt: null,
      readAt: null,
      failureCode: e.code,
      failureReason: e.message ? e.message.slice(0, 500) : null,
    };
  }
  const readAt = st.readAt ?? st.respondedAt;
  // a later step implies the earlier one: a read message was delivered at least when it was read
  const deliveredAt = st.deliveredAt ?? readAt;
  const status = readAt ? 'read' : deliveredAt ? 'delivered' : 'sent';
  return { wamid, status, deliveredAt, readAt, failureCode: null, failureReason: null };
}

/** Several log rows for one wamid (a retry, a duplicate): the furthest step wins; a failure only stands when nothing got further. */
export function mergeReceipts(a: Receipt, b: Receipt): Receipt {
  return RANK[b.status] > RANK[a.status] || (a.status === 'failed' && b.status !== 'failed') ? b : a;
}

export interface MessageRow {
  id: number | string;
  status: string;
}

/** Pure: which loaded messages move on. Only forward (sent -> delivered -> read, or sent -> failed); never back, never a row the app has moved. */
export function classifyDelivery(
  rows: MessageRow[],
  want: Map<string, Receipt>,
  key: (r: MessageRow) => string,
): { todo: Array<{ id: number; receipt: Receipt }>; alreadyRight: number; kept: number; noReceipt: number } {
  const out = { todo: [] as Array<{ id: number; receipt: Receipt }>, alreadyRight: 0, kept: 0, noReceipt: 0 };
  for (const r of rows) {
    const w = want.get(key(r));
    if (!w) out.noReceipt++;
    else if (w.status === 'sent') out.alreadyRight++;
    else if (r.status !== 'sent') {
      if (r.status === w.status) out.alreadyRight++;
      else out.kept++; // the live app already moved it (a webhook receipt): never overwritten
    } else out.todo.push({ id: Number(r.id), receipt: w });
  }
  return out;
}
