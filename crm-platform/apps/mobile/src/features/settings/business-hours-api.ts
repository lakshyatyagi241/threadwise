import { businessHoursSchema, type UpdateBusinessHoursInput } from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * The calls behind Settings, Business hours (TW-TIB2-004): the weekly schedule and the time zone that the routing condition "outside
 * business hours" and the SLA clock read. Every route needs the plan feature `inbox_routing` (422 PLAN_FEATURE_LOCKED, reads included);
 * reading needs `inbox.settings.read`, saving `inbox.routing.manage`.
 */

/** The saved schedule (Monday to Friday, 09:00 to 18:00, when none was saved) and whether this person may change the time zone. */
export const fetchBusinessHours = (signal?: AbortSignal) =>
  apiFetch('/v2/inbox/routing/business-hours', { schema: businessHoursSchema, signal });

/** Replaces the seven day windows. The time zone is kept only when the caller is the workspace owner; for anyone else it is ignored. */
export const saveBusinessHours = (body: UpdateBusinessHoursInput) =>
  apiFetch('/v2/inbox/routing/business-hours', {
    method: 'PUT',
    body,
    schema: businessHoursSchema,
  });
