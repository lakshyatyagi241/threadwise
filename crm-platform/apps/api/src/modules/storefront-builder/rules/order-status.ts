import { STORE_ORDER_STATUSES, type StoreOrderStatus } from '@crm/contracts';

/**
 * The order status rules of WaDesk `WaOrderController::updateStatus`. There is no state machine: the operator moves an order to any
 * status of the list, including back out of `cancelled` and `completed` (kept, it is how operators fix a mis-click). What is derived
 * is what happens around the change, not whether it is allowed.
 */
export const isOrderStatus = (v: string): v is StoreOrderStatus =>
  (STORE_ORDER_STATUSES as readonly string[]).includes(v);

/** Any known status to any known status, the same one included (a save that only changes the note or the link). */
export const canMoveOrder = (from: string, to: string): boolean =>
  isOrderStatus(to) && isOrderStatus(from);

export interface StatusPlan {
  statusChanged: boolean;
  /** A payment link was typed on the form (non-blank). */
  linkTyped: boolean;
  /** WaDesk DMs the buyer when the status changed or a link was typed, and only when the order has a phone. */
  notifyBuyer: boolean;
  /** WaDesk flagged an auto-invoice on the move to paid or completed. */
  invoiceDue: boolean;
}

/** What a status form submission does, from the order's current status and what was submitted. */
export function planStatusUpdate(
  current: string,
  next: string,
  typedLink: string | null | undefined,
  buyerPhone: string | null,
): StatusPlan {
  const statusChanged = current !== next;
  const linkTyped = (typedLink ?? '').trim() !== '';
  return {
    statusChanged,
    linkTyped,
    notifyBuyer: (buyerPhone ?? '').trim() !== '' && (statusChanged || linkTyped),
    invoiceDue: statusChanged && (next === 'paid' || next === 'completed'),
  };
}
