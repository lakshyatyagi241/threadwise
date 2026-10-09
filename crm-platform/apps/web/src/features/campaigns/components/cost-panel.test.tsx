import { describe, expect, it } from 'vitest';
import { html } from '../wizard/testing';
import { CostPanel } from './builder/cost-panel';
import type { CreditQuery } from '../wizard/components/credit-card';

const check = (over: Record<string, unknown>): CreditQuery => ({
  data: {
    currency: 'USD',
    balanceMinor: 1000,
    estimatedCostMinor: 0,
    fullCostMinor: 400,
    shortfallMinor: 0,
    sufficient: true,
    recipients: 1,
    chargeableMessages: 0,
    billingMode: 'plan',
    topupUrl: '/wallet',
    lines: [],
    ...over,
  } as never,
  isPending: false,
  isError: false,
  error: null,
  refetch: () => undefined,
});

describe('the cost block', () => {
  it('says what is missing before it can count', () => {
    const q = { isPending: true, isError: false, error: null, refetch: () => undefined };
    expect(html(<CostPanel credit={q} hasTemplate={false} hasAudience />)).toContain(
      'Choose a template',
    );
    expect(html(<CostPanel credit={q} hasTemplate hasAudience={false} />)).toContain(
      'Choose who receives it',
    );
  });

  it('shows the cost, the balance and "Balance is enough", with the plan note', () => {
    const out = html(<CostPanel credit={check({})} hasTemplate hasAudience />);
    expect(out).toContain('Balance is enough for the full cost of $4.00');
    expect(out).toContain('$10.00');
    // The real cost is shown even though the plan covers it; what the wallet pays now is a separate line.
    expect(out).toContain('Estimated cost (full)');
    expect(out).toContain(
      'Charged to your wallet now: $0.00 (your plan covers 1 of these messages)',
    );
  });

  it('shows the shortfall and a top-up link when the wallet cannot cover it', () => {
    const out = html(
      <CostPanel
        credit={check({
          sufficient: false,
          shortfallMinor: 250,
          estimatedCostMinor: 1250,
          fullCostMinor: 1250,
          billingMode: 'wallet',
        })}
        hasTemplate
        hasAudience
      />,
    );
    expect(out).toContain('Balance is not enough: you need $2.50 more.');
    expect(out).toContain('href="/wallet"');
  });
});
