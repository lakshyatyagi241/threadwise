import {
  STORE_ORDER_SOURCES,
  STORE_ORDER_STATUSES,
  STORE_PAYMENT_STATUSES,
  type StoreOrderSource,
  type StoreOrderStatus,
  type StorePaymentStatus,
} from '@crm/contracts';

/** Badge colours, shared by every screen so an order status always looks the same. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const ORDER_STATUSES = STORE_ORDER_STATUSES;
export const ORDER_SOURCES = STORE_ORDER_SOURCES;
export const PAYMENT_STATUSES = STORE_PAYMENT_STATUSES;

const ORDER_TONES: Record<StoreOrderStatus, Tone> = {
  new: 'info',
  pending: 'warning',
  confirmed: 'info',
  paid: 'success',
  processing: 'warning',
  completed: 'success',
  shipped: 'info',
  cancelled: 'danger',
};

const PAYMENT_TONES: Record<StorePaymentStatus, Tone> = {
  paid: 'success',
  awaiting: 'warning',
  cod: 'neutral',
  unpaid: 'danger',
};

export const isOrderStatus = (v: string): v is StoreOrderStatus =>
  (ORDER_STATUSES as readonly string[]).includes(v);
export const isOrderSource = (v: string): v is StoreOrderSource =>
  (ORDER_SOURCES as readonly string[]).includes(v);
export const isPaymentStatus = (v: string): v is StorePaymentStatus =>
  (PAYMENT_STATUSES as readonly string[]).includes(v);

/** An unknown status (an older or newer server) is shown plain rather than failing. */
export const orderTone = (status: string): Tone =>
  isOrderStatus(status) ? ORDER_TONES[status] : 'neutral';
export const paymentTone = (status: string): Tone =>
  isPaymentStatus(status) ? PAYMENT_TONES[status] : 'neutral';

/** Classes of a badge in one tone (light and dark through the theme tokens). */
export const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-primary/10 text-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
};

/**
 * WaDesk lets the operator move an order to ANY status (there is no state machine), so every status is offered. What the screen
 * adds is a hint: the statuses that tell the buyer something, and the one that is the usual next step.
 */
export function nextStatusSuggestion(status: string): StoreOrderStatus | null {
  switch (status) {
    case 'new':
    case 'pending':
      return 'confirmed';
    case 'confirmed':
      return 'processing';
    case 'processing':
      return 'shipped';
    case 'shipped':
      return 'completed';
    default:
      return null;
  }
}

/** Statuses an order cannot usefully leave without a reason: shown with a confirm. */
export const isTerminalStatus = (status: string): boolean =>
  status === 'cancelled' || status === 'completed';
