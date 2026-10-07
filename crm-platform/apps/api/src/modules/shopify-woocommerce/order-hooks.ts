import { Injectable, Logger } from '@nestjs/common';
import type { StoreKind } from './mirror-rules';

/**
 * A store order that came from a flow's shop node (WD-FLR-041): the checkout the node minted carries the run's reference
 * (`wadesk-flow:<ref>`) in the order's note (Shopify) or in the `_wa_flow_session` meta or the customer note (WooCommerce), and the
 * order webhook reads it back here.
 */
export interface EcomFlowOrder {
  orgId: number;
  kind: StoreKind;
  storeId: number;
  /** The run reference the shop node put in the checkout. */
  flowRef: string;
  orderId: string;
  total: string;
  currency: string;
}

export interface EcomOrderListener {
  readonly name: string;
  onFlowOrder(event: EcomFlowOrder): Promise<void>;
}

/** What a checkout puts in an order's note so the order finds its run again; the shop node's `flowTag` reads the same text. */
export const flowNoteOf = (runRef: string): string => `wadesk-flow:${runRef}`;

const TAG = /wadesk-flow:(\S+)/;
const clean = (s: string): string => s.replace(/[.,;)"']+$/, '');

/** The run reference a store order carries, or null when the order did not come from a flow. */
export function flowRefOf(kind: StoreKind, data: Record<string, unknown>): string | null {
  const fromNote = (note: unknown): string | null => {
    const m = TAG.exec(typeof note === 'string' ? note : '');
    return m ? clean(m[1]!) : null;
  };
  if (kind === 'shopify') return fromNote(data.note);
  const meta = Array.isArray(data.meta_data)
    ? (data.meta_data as Array<Record<string, unknown>>)
    : [];
  const tagged = meta.find((m) => m.key === '_wa_flow_session' && m.value);
  if (tagged) return clean(String(tagged.value));
  return fromNote(data.customer_note);
}

/**
 * Where a domain that reacts to a store order announces itself (the flow runtime resumes a shop node on `purchased`). The webhook
 * pipeline calls `run` once per order event that carries a flow reference; a listener that throws never fails the delivery.
 */
@Injectable()
export class EcomOrderHooks {
  private readonly logger = new Logger(EcomOrderHooks.name);
  private readonly listeners: EcomOrderListener[] = [];

  register(listener: EcomOrderListener): void {
    if (this.listeners.some((l) => l.name === listener.name)) return;
    this.listeners.push(listener);
  }

  async run(event: EcomFlowOrder): Promise<void> {
    for (const l of this.listeners) {
      try {
        await l.onFlowOrder(event);
      } catch (err) {
        this.logger.error({ listener: l.name, orgId: event.orgId, err }, 'order listener failed');
      }
    }
  }
}
