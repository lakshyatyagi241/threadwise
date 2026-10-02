import type { PlansResponse } from '@crm/contracts';

/**
 * The plan name under the person's email in the rail (WD-AUTH-024): the name of
 * the workspace's current plan card, else the plan slug the API reports, else
 * the session's own plan value; a missing or "free" plan reads as the free label.
 */
export function planBadgeName(
  plans: Pick<PlansResponse, 'data' | 'currentSlug'> | undefined,
  sessionPlan: string | null | undefined,
  freeLabel: string,
): string {
  const card = plans?.data.find((p) => p.current);
  if (card?.name.trim()) return card.name.trim();
  const slug = (plans?.currentSlug ?? sessionPlan ?? '').trim();
  if (!slug || slug.toLowerCase() === 'free') return freeLabel;
  return slug;
}
