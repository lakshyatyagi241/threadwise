/**
 * @crm/tax: pure TypeScript money, tax and invoice-totals engine. No Node-only and no browser-only API (only `Intl`, which both
 * have, with a plain fallback). All amounts are `bigint` minor units; no float touches money.
 *
 * Preset rates and rules are DEFAULTS for the user to verify, not legal or tax advice. See docs/tax-engine.md.
 */

// money
export * from './money/rounding';
export * from './money/currency';
export * from './money/decimal';
export * from './money/cash';
export * from './money/format';

// totals
export * from './totals/types';
export * from './totals/calculate';
export * from './totals/settle';

// profiles
export * from './profiles/types';
export * from './profiles/validators';
export * from './profiles/registry';
export * from './profiles/resolve';
export * from './profiles/presets';
export * from './profiles/compliance';
export { rateInForce, isIsoDate } from './profiles/utils';
export { INDIA_STATES, indiaState, indiaSplit } from './profiles/countries/india';
export { US_STATES } from './profiles/countries/us';
export { CA_PROVINCES } from './profiles/countries/canada';
export { EU_MEMBER_CODES, isEuMember, OSS_THRESHOLD_EUR } from './profiles/countries/eu';

// fiscal year and numbering
export * from './fiscal/fiscal-year';
export * from './fiscal/invoice-number';
