# Seeding the paid first-party Marketplace apps on a local database

Appointments, Forms and Email (Gmail) are **paid first-party Marketplace apps**. The migrations seed each listing as a **draft with no price** (the price is
the platform operator's decision, so nothing is hard-coded), and no plan includes the feature, so on a fresh developer database no app is
visible and their routes answer `PLAN_FEATURE_LOCKED`. Three commands do what the operator does in the console, through the same services (so
validation, the billing add-on, entitlements and audit rows are identical):

```bash
pnpm --filter @crm/api build            # the commands run from dist (like auto-reply:translate-existing)
pnpm --filter @crm/api seed:forms -- --workspace <slug>          # 799 INR a month, Forms menu appears for that workspace
pnpm --filter @crm/api seed:email -- --workspace <slug>          # 499 INR a month, Email (Gmail) menu appears for that workspace
pnpm --filter @crm/api seed:appointments                         # 499 INR a month, comps workspaces already using booking
```

They run from the build because the application's dependency injection needs the compiler's decorator metadata, which `tsx` does not emit, so
run `pnpm --filter @crm/api build` first and again after you change the code. Run `pnpm --filter @crm/api seed:auth` first if you have never
created a platform operator (it creates `operator@example.test`).

| Command             | Listing        | Default price   | Grants                | Comps by default                                               |
| ------------------- | -------------- | --------------- | --------------------- | -------------------------------------------------------------- |
| `seed:appointments` | `appointments` | 499 INR monthly | `appointment_booking` | workspaces already using booking ("comp existing")             |
| `seed:forms`        | `forms`        | 799 INR monthly | `form_builder`        | nobody (no workspace used Forms before it existed)             |
| `seed:email`        | `email`        | 499 INR monthly | `email_channel`       | nobody (no workspace used the Gmail channel before it existed) |

799 INR is decision D1 of [../specs/forms-builder-app.md](../specs/forms-builder-app.md); no trial by default (a trial only makes sense with the AI
generations capped).

## Options

| Flag                 | Meaning                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `--price <amount>`   | monthly price in major units                                                                                                     |
| `--currency <code>`  | three-letter code, must be enabled on the platform                                                                               |
| `--workspace <slug>` | comp just that workspace (the same action as "Comp" in the console: a comped subscription with no end date, so its menu appears) |
| `--all-workspaces`   | development convenience: comp **every** active workspace. Prints the list. A real run needs `--yes`; `--dry-run` only lists      |
| `--yes`              | confirms `--all-workspaces`                                                                                                      |
| `--dry-run`          | show what would change, write nothing                                                                                            |
| `--force`            | replace a price an operator already set, show a hidden listing again, enable the add-on on plans an operator left out            |

The workspace slug is on the `organizations` row (the default dev workspace is `Admin`, org id 1; others look like `org-xyz`).

## What it does (in this order)

1. Sets the listing price, which creates the billing add-on pack that sells the app (`mkt_...`, one month, carrying the granted feature).
2. Comps: the workspaces named by `--workspace` / `--all-workspaces`; for Appointments, otherwise the workspaces already using booking.
   Forms and Email have no existing users, so by default nobody is comped.
3. Approves version `1.0.0` and publishes the listing.
4. If the table `plan_visible_addons` exists, shows the add-on on every active plan; otherwise prints a note and skips.

Comp comes before publish on purpose: it reads what each workspace has at that moment.

## Safety

- Refuses `NODE_ENV=production`, and refuses unless `DATABASE_URL` and `MIGRATION_DATABASE_URL` (when set), including any `?host=` override, point at
  `localhost`, `127.0.0.1`, `host.docker.internal` or a `*.local` name. Nothing connects before this check.
- Acts as the first active `super_admin` platform operator (found by role; printed at the start, no console sign-in needed).
- Idempotent: a second run changes nothing and says so.
- Never overwrites an operator's decision without `--force`: an existing price, a published, hidden or killed listing, a workspace that already has a
  subscription, plans an operator left out of the add-on's visibility.
- Prints a before and after summary.

## The manual way (fallback)

Operator console, `platform.market.pricing` and `platform.market.review` permissions (a super admin has both):

1. Marketplace, the app, **Pricing**: paid monthly, price, currency, keep the granted plan feature. Creates the add-on.
2. Appointments only: **Comp existing users** (dry run, then for real). Any app: **Comp** a workspace to give it the app without paying.
3. **Versions**: approve `1.0.0`, then **Publish**.
4. If your build has plan visibility: **Plans**, edit each plan, enable the app's add-on.

Forms in full: [forms-app-operator-setup.md](forms-app-operator-setup.md). Email (Gmail), including the Google credentials the seed does not set up: [email-integration-operator-setup.md](email-integration-operator-setup.md). Appointments: [dev-seed-appointments-app.md](dev-seed-appointments-app.md),
and [../api/marketplace.md](../api/marketplace.md) for the reasoning.
