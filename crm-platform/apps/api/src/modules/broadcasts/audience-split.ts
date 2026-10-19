/**
 * Splits one audience across the picked senders by weight (TW-BCAST-014).
 *
 * The rule lives in `@crm/contracts` (`campaigns/sender-split.ts`) so the Campaign wizard's Review step shows the very same counts the
 * server cuts: a missing or non-positive weight counts as 1; each sender gets floor(share of the total), and the leftover goes one at a
 * time to the senders with the largest fractional part (ties to the sender picked first), so the split is within 1 of the exact
 * weighted ideal and the sizes always add up to the total. Buckets are sequential slices, so each contact lands in exactly one.
 */
export { splitSizes, splitAudience } from '@crm/contracts';
