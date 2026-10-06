/**
 * Per-app configuration of the local-development Marketplace seed commands (`seed:appointments`, `seed:forms`). Everything that differs
 * between the apps lives here; the guarded steps (price, add-on, comp, approve and publish, plan visibility) are shared in
 * seed-app.runner.ts and the argument rules in seed-app.args.ts.
 */
export interface SeedAppConfig {
  /** The listing slug in `marketplace_apps`. */
  slug: string;
  /** Human name used in messages. */
  label: string;
  /** The package script, used in usage text and in the audit payload. */
  command: string;
  /** Monthly price in major units when `--price` is not given. */
  defaultPrice: string;
  defaultCurrency: string;
  /** The plan feature the add-on grants (what the app turns on in a workspace). */
  feature: string;
  /** The version approved and published (the manifest the migration seeds); falls back to the newest when absent. */
  version: string;
  /**
   * Whether "comp existing users" applies: the feature was in use before it became a paid app (Appointments), so workspaces that already
   * use it are comped to keep it. False for an app no workspace could use before it existed (Forms).
   */
  grandfatherExisting: boolean;
  /** What "already using it" means, for messages (only when `grandfatherExisting`). */
  usageNoun: string;
  /** The migration that seeds the listing, for the "not found" hint. */
  migration: string;
}

export const APPOINTMENTS_CONFIG: SeedAppConfig = {
  slug: 'appointments',
  label: 'Appointments',
  command: 'seed:appointments',
  defaultPrice: '499',
  defaultCurrency: 'INR',
  feature: 'appointment_booking',
  version: '1.0.0',
  grandfatherExisting: true,
  usageNoun: 'booking',
  migration: '20261023090200_mkt_appointments_app',
};

export const FORMS_CONFIG: SeedAppConfig = {
  slug: 'forms',
  label: 'Forms',
  command: 'seed:forms',
  // Decision D1 of docs/specs/forms-builder-app.md: 799 INR a month (about 9.99 USD); a trial only with the AI generations capped, so none by default.
  defaultPrice: '799',
  defaultCurrency: 'INR',
  feature: 'form_builder',
  version: '1.0.0',
  grandfatherExisting: false,
  usageNoun: 'forms',
  migration: '20261031100200_mkt_forms_app',
};
