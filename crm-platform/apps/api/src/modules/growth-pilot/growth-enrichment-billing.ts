/**
 * What a contact lookup is charged under: the contact and the UTC day. A lookup is asked for a contact at most once in 30 days, so the id
 * only has to survive a retry: if the lookup was saved but the run died before the day ended and asks about the same contact again
 * (a restarted sweeper), the wallet recognises the id and takes nothing the second time.
 */
export const enrichmentUsageId = (contactId: number, at: Date): string =>
  `enrich:${contactId}:${at.toISOString().slice(0, 10)}`;

/**
 * Whether a lookup that ended in `status` is billed. `found` and `not_found` both reached the provider and used a request of ours; a
 * `failed` one (a timeout, a provider error) gave nothing and costs the customer nothing.
 */
export const isBillableLookup = (status: 'found' | 'not_found' | 'failed'): boolean =>
  status !== 'failed';
