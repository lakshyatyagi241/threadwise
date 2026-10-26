import { describe, expect, it } from 'vitest';
import {
  NEW_PLAN_FEATURES_OFF,
  PLAN_FEATURE_DEFS,
  REMINDER_CONFIRM_BUTTONS_FEATURE,
  REMINDER_REBOOK_FEATURE,
  storedFeature,
} from '@crm/contracts';
import type { Entitlements } from '../../../src/modules/plans-subscriptions-trials/plan-entitlement.service';
import {
  REMINDER_LOCKED_MESSAGE,
  reminderPartsOf,
} from '../../../src/modules/appointments-booking/reminder-plan';

/**
 * The upgrade tier of the Appointments app (owner decision 2026-10-22): timed reminders come with `appointment_booking`; the buttons and the
 * rebook steps need their own plan feature on top of it, and default to off.
 */
function ent(over: Partial<Entitlements> = {}): Entitlements {
  return {
    orgId: 1,
    planSlug: 'basic',
    planKnown: true,
    planName: 'Basic',
    trialEndsAt: null,
    planEndsAt: null,
    billingCycle: 'monthly',
    platformOwned: false,
    overrides: {},
    planLimits: {},
    planFeatures: {},
    state: 'paid_active',
    visibleApps: { all: false, appIds: new Set() },
    appWithheld: {},
    ...over,
  };
}
const BOOKING = { appointment_booking: true };

describe('the registry', () => {
  it('has both upgrade flags off by default, and a new plan starts without them', () => {
    for (const k of [REMINDER_CONFIRM_BUTTONS_FEATURE, REMINDER_REBOOK_FEATURE]) {
      expect(PLAN_FEATURE_DEFS.find((d) => d.key === k)!.default, k).toBe(false);
      expect(NEW_PLAN_FEATURES_OFF, k).toContain(k);
      // a plan row that does not store the key reads as off
      expect(storedFeature({}, k as never), k).toBe(false);
      expect(storedFeature({ appointment_booking: true }, k as never), k).toBe(false);
    }
  });
});

describe('what a workspace gets of the reminder sequences', () => {
  it('app only: timed reminders, but no buttons and no rebook steps', () => {
    expect(reminderPartsOf(ent({ planFeatures: BOOKING }))).toEqual({
      buttons: false,
      rebook: false,
    });
  });

  it('a plan that stores a flag turns on just that part', () => {
    expect(
      reminderPartsOf(ent({ planFeatures: { ...BOOKING, appointment_confirm_buttons: true } })),
    ).toEqual({ buttons: true, rebook: false });
    expect(
      reminderPartsOf(ent({ planFeatures: { ...BOOKING, appointment_rebook_steps: true } })),
    ).toEqual({ buttons: false, rebook: true });
    expect(
      reminderPartsOf(
        ent({
          planFeatures: {
            ...BOOKING,
            appointment_confirm_buttons: true,
            appointment_rebook_steps: true,
          },
        }),
      ),
    ).toEqual({ buttons: true, rebook: true });
  });

  it('a flag without the app gives nothing: both need appointment_booking', () => {
    expect(
      reminderPartsOf(
        ent({
          planFeatures: {
            appointment_booking: false,
            appointment_confirm_buttons: true,
            appointment_rebook_steps: true,
          },
        }),
      ),
    ).toEqual({ buttons: false, rebook: false });
    expect(
      reminderPartsOf(
        ent({
          planFeatures: { appointment_confirm_buttons: true, appointment_rebook_steps: true },
        }),
      ),
    ).toEqual({ buttons: false, rebook: false });
  });

  it('a workspace override wins in both directions', () => {
    expect(
      reminderPartsOf(
        ent({
          planFeatures: { ...BOOKING, appointment_confirm_buttons: true },
          overrides: { features: { appointment_confirm_buttons: false } },
        }),
      ).buttons,
    ).toBe(false);
    expect(
      reminderPartsOf(
        ent({ planFeatures: BOOKING, overrides: { features: { appointment_rebook_steps: true } } }),
      ).rebook,
    ).toBe(true);
  });

  it('a platform-owned workspace has everything; a missing entitlement row has nothing', () => {
    expect(reminderPartsOf(ent({ platformOwned: true }))).toEqual({ buttons: true, rebook: true });
    expect(reminderPartsOf(null)).toEqual({ buttons: false, rebook: false });
  });

  it('a downgrade changes the answer for the next send without touching anything stored', () => {
    const before = ent({
      planFeatures: {
        ...BOOKING,
        appointment_confirm_buttons: true,
        appointment_rebook_steps: true,
      },
    });
    const after = ent({ planFeatures: BOOKING });
    expect(reminderPartsOf(before)).toEqual({ buttons: true, rebook: true });
    expect(reminderPartsOf(after)).toEqual({ buttons: false, rebook: false });
  });
});

describe('the sentence of a locked part', () => {
  it('names the tier that unlocks it', () => {
    expect(REMINDER_LOCKED_MESSAGE.buttons).toContain('Appointments upgrade tier');
    expect(REMINDER_LOCKED_MESSAGE.rebook).toContain('Appointments upgrade tier');
  });
});
