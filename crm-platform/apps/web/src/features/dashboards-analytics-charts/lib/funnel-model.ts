import type { DashFunnel } from '@crm/contracts';

/** One row of the contact-based Engagement funnel. */
export interface FunnelStage {
  key: 'messaged' | 'delivered' | 'replied';
  count: number;
  /** Percent of contacts messaged, one decimal, never above 100 (a contact can reply without being messaged in the window). */
  pct: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * The stages the Engagement funnel card draws, in order. EXTENSION POINT: a fourth stage "Goal completed" belongs at the end of
 * this array once the product records a goal event (blocked: no goal event exists in the data model, so it is not built and
 * nothing is invented). The component only maps over this list, so adding a stage needs a key here, a message under
 * `funnel.stage.<key>` and the count in the contract.
 */
export function funnelStages(funnel: DashFunnel): FunnelStage[] {
  const { messaged, delivered, replied } = funnel.contacts;
  const of = (n: number) => (messaged > 0 ? Math.min(100, round1((n / messaged) * 100)) : 0);
  return [
    { key: 'messaged', count: messaged, pct: messaged > 0 ? 100 : 0 },
    { key: 'delivered', count: delivered, pct: of(delivered) },
    { key: 'replied', count: replied, pct: of(replied) },
  ];
}
