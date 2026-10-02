import { CanActivate, HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  PLAN_UPGRADE_PATH,
  type PlanFeatureKey,
  type PlanLimitKey,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import {
  PlanEntitlementService,
  resolveFeature,
  type Entitlements,
} from '../plans-subscriptions-trials';

/**
 * The plan side of appointments (WD-APPT-001, 035). WaDesk gated the area on `access_appointment_booking` (the booking-type routes by
 * middleware, the rest by a URL map) and capped bookings with `appointments_limit` (0 or empty = unlimited).
 *
 * Both keys are in the plan registry (PLAN_FEATURE_DEFS / PLAN_LIMIT_DEFS in @crm/contracts), so the plan editor renders them.
 * `appointment_booking` defaults to enabled (the package column's default) and `appointments` to unlimited, so a plan row that
 * predates them is neither locked nor capped.
 */
export const APPOINTMENT_FEATURE = 'appointment_booking' satisfies PlanFeatureKey;
export const APPOINTMENT_LIMIT_KEY = 'appointments' satisfies PlanLimitKey;

/** Pure: the flag for one organization. Platform-owned and plan-less organizations are never locked out. */
export function appointmentsEnabled(e: Entitlements | null): boolean {
  return e ? resolveFeature(e, APPOINTMENT_FEATURE) : false;
}

@Injectable()
export class AppointmentPlan {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  async isEnabled(orgId: number): Promise<boolean> {
    return appointmentsEnabled(await this.entitlements.forOrg(orgId));
  }

  /** 422 PLAN_FEATURE_LOCKED when the plan has no appointment booking. Reads are refused too (D-01). */
  async assertEnabled(orgId: number): Promise<void> {
    if (await this.isEnabled(orgId)) return;
    throw new AppError(
      ERROR_CODES.PLAN_FEATURE_LOCKED,
      "Your plan doesn't include appointment booking. Upgrade to unlock it.",
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        { path: 'feature', message: APPOINTMENT_FEATURE },
        { path: 'reason', message: 'feature_disabled' },
        { path: 'upgradeUrl', message: PLAN_UPGRADE_PATH },
      ],
    );
  }

  /** What the public pages answer when booking is off: the same for a missing flag and a reached cap, and no upgrade hint. */
  async assertOffered(orgId: number): Promise<void> {
    if (await this.isEnabled(orgId)) return;
    throw unavailable();
  }

  /** 422 PLAN_LIMIT_REACHED when one more booking in that month would pass the plan's cap (0 = unlimited). */
  async assertWithinCap(orgId: number, usedInMonth: number): Promise<void> {
    await this.entitlements.assertWithinLimit(orgId, APPOINTMENT_LIMIT_KEY, usedInMonth);
  }

  async cap(orgId: number): Promise<number> {
    return this.entitlements.limit(orgId, APPOINTMENT_LIMIT_KEY);
  }
}

export const unavailable = (): AppError =>
  new AppError(
    ERROR_CODES.APPT_BOOKING_UNAVAILABLE,
    "Online booking isn't available right now.",
    HttpStatus.CONFLICT,
  );

/** Every staff appointments controller carries this: the plan check runs after authentication and the permission guard. */
@Injectable()
export class AppointmentBookingGuard implements CanActivate {
  constructor(private readonly plan: AppointmentPlan) {}

  async canActivate(): Promise<boolean> {
    await this.plan.assertEnabled(RequestContextStore.require().orgId);
    return true;
  }
}
