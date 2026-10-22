import { Injectable } from '@nestjs/common';
import {
  REMINDER_CONFIRM_BUTTONS_FEATURE,
  REMINDER_REBOOK_FEATURE,
  type PlanFeatureKey,
} from '@crm/contracts';
import {
  PlanEntitlementService,
  featureLocked,
  resolveFeature,
  type Entitlements,
} from '../plans-subscriptions-trials';
import { appointmentsEnabled } from './booking-plan';

/**
 * The UPGRADE TIER of the Appointments app (owner decision 2026-10-22). Timed WhatsApp and email reminders, the packs, the test email, the
 * email fallback, the delivery report and the per-appointment history come with `appointment_booking` (the app). Two parts need more:
 *
 *  - the Confirm / Reschedule / Cancel buttons: plan feature `appointment_confirm_buttons`
 *  - the rebook (recall) steps: plan feature `appointment_rebook_steps`
 *
 * Both need `appointment_booking` as well, so a plan row that carries one of them but no app still gets neither. Every place that decides
 * (the save of a step, the pack, the worker that sends, the report) asks this one function, so they cannot disagree.
 */
export interface ReminderParts {
  buttons: boolean;
  rebook: boolean;
}

export function reminderPartsOf(e: Entitlements | null): ReminderParts {
  if (!e || !appointmentsEnabled(e)) return { buttons: false, rebook: false };
  return {
    buttons: resolveFeature(e, REMINDER_CONFIRM_BUTTONS_FEATURE),
    rebook: resolveFeature(e, REMINDER_REBOOK_FEATURE),
  };
}

/** What a locked part says: which tier unlocks it. The code is the usual 422 PLAN_FEATURE_LOCKED. */
export const REMINDER_LOCKED_MESSAGE: Record<keyof ReminderParts, string> = {
  buttons:
    'The Confirm, Reschedule and Cancel buttons are part of the Appointments upgrade tier. Switch to a plan that includes them to switch them on.',
  rebook:
    'Rebook messages are part of the Appointments upgrade tier. Switch to a plan that includes them to switch them on.',
};

const KEY: Record<keyof ReminderParts, PlanFeatureKey> = {
  buttons: REMINDER_CONFIRM_BUTTONS_FEATURE,
  rebook: REMINDER_REBOOK_FEATURE,
};

@Injectable()
export class ReminderPlan {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  async parts(orgId: number): Promise<ReminderParts> {
    return reminderPartsOf(await this.entitlements.forOrg(orgId));
  }

  /** 422 PLAN_FEATURE_LOCKED when the workspace lacks the part. */
  async assert(orgId: number, part: keyof ReminderParts): Promise<void> {
    const e = await this.entitlements.forOrg(orgId);
    if (reminderPartsOf(e)[part]) return;
    throw featureLocked(e, KEY[part], REMINDER_LOCKED_MESSAGE[part]);
  }
}
