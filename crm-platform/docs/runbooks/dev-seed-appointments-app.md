# Seeding the Appointments app on a local database

> Both paid first-party apps (Appointments and Forms) are covered together in [dev-seed-marketplace-apps.md](dev-seed-marketplace-apps.md); the two commands share one implementation.

Appointments (booking types, appointments, public booking pages) is a **paid first-party Marketplace app**. On a fresh developer database
you will not see it in the Marketplace and booking is locked. This is by design, not a bug:

- the migration `20261023090200_mkt_appointments_app` seeds the listing as a **draft with no price** (the price is the platform operator's
  decision, so nothing is hard-coded and publishing is refused until it is set);
- every plan has `appointment_booking: false`, so no plan includes booking;
- a workspace gets booking only through a subscription to the app (bought, or comped by the operator).

The owner priced, comped and published it in the operator console on their own database. Yours does not have those operator actions yet.

## The quick way

```bash
pnpm --filter @crm/api build
pnpm --filter @crm/api seed:appointments            # 499 INR per month
pnpm --filter @crm/api seed:appointments -- --dry-run          # show what it would do, write nothing
pnpm --filter @crm/api seed:appointments -- --price 999 --currency USD
pnpm --filter @crm/api seed:appointments -- --workspace <slug> # comp just that workspace
```

Run `pnpm --filter @crm/api seed:auth` first if you have never created a platform operator (it creates `operator@example.test`).
It runs from the build, like `auto-reply:translate-existing`, because the application's dependency injection needs the compiler's
decorator metadata, which `tsx` does not emit.

It does what the operator does in the console, through the same services (so audit rows, the billing add-on, entitlements and validation
are identical), acting as the seeded **super admin operator** (found by role in `platform_operators`; you never sign in to the console):

1. sets the listing price (default 499, INR, monthly), which creates the billing add-on pack that sells the app;
2. **comps** the workspaces that already use booking (a booking type or an appointment exists) so they keep it, the "Comp existing
   users" action (or, with `--workspace`, only that workspace);
3. approves version 1.0.0 and **publishes** the listing;
4. if the table `plan_visible_addons` exists (plan visibility), enables the add-on on every active plan; otherwise prints a note and skips.

The comp comes before the publish on purpose: it reads what each workspace has at that moment.

### Safety

- Refuses `NODE_ENV=production`, and refuses unless `DATABASE_URL` (and `MIGRATION_DATABASE_URL`, when set) point at `localhost`,
  `127.0.0.1`, `host.docker.internal` or a `*.local` name.
- Idempotent: a second run changes nothing and says so.
- Never overwrites an operator's decision unless you pass `--force`: an existing price (even a different one), a listing that is
  published, hidden or killed, a workspace that already has a subscription, or plans an operator left out of the add-on's visibility.
  `--force` replaces the price and enables the add-on on every active plan, and shows a hidden listing again; it never un-kills one.
- It prints a before and after summary. `--dry-run` writes nothing.

To give a test workspace booking without a booking type, run `seed:appointments -- --workspace <slug>` (the slug is on the
organization row, for example `org-xyz`).

## The manual way (what the script automates)

In the operator console (`platform.market.pricing` and `platform.market.review` permissions, a super admin has both):

1. Marketplace, **Appointments**, Pricing: paid monthly, price 499, currency INR, keep **grants plan feature** `appointment_booking` and
   **comp existing users** on, save. This creates the add-on.
2. Same page, **Comp existing users**: dry run, then run for real. It comps every workspace with booking types or appointments.
3. Versions: approve 1.0.0, then **Publish**.
4. If your build has plan visibility: Plans, edit each plan, enable the **Appointments (Marketplace)** add-on.

Deployment order and the reasoning are in [docs/api/marketplace.md](../api/marketplace.md), section "Apps that own existing plan
features" and "Appointments is the first paid first-party app".
