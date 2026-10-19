/**
 * Pure rules of the business-hours settings (TW-TIB2-001). The schedule maths is shared with the Settings "Working hours" card, so it
 * lives in `common/business-hours-schedule.ts`; what is specific to this screen stays here.
 */
export {
  defaultBusinessHoursDays,
  mergeBusinessHours,
  readBusinessHoursDays,
  readBusinessHoursHolidays,
  sameDays,
  sameHolidays,
} from '../../common/business-hours-schedule';

/**
 * Who may change the workspace time zone (Reference: the owner only; anyone else's value is ignored on save). A workspace that names no
 * owner has nobody the rule can point at, so whoever may manage routing (Owner and Admin by default) may set it.
 */
export function mayEditTimezone(ownerUuid: string | null, actorUuid: string | null): boolean {
  if (ownerUuid === null) return true;
  return actorUuid !== null && ownerUuid === actorUuid;
}
