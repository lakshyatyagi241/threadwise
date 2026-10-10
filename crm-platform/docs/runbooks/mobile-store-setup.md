# Mobile: accounts, identity and first store submission

Do this early. Apple and Google verification takes days, and the first review takes longer than any later one. Nothing here can be done by code. Decisions: [handover](../mobile/handover.md), [ADR-0026](../adr/0026-mobile-release-and-versioning.md).

## 1. Decide (owner)

- **Bundle id / package name**, e.g. `com.<company>.<product>`: cannot change after the first upload. Set it with `APP_BUNDLE_ID` (EAS environment variable) so `app.config.ts` produces `<id>`, `<id>.preview`, `<id>.dev`.
- **App name** (store listing and under the icon), **publisher name**, support email and URL, privacy policy URL, marketing URL.
- Who is the **account holder** for each store: a company-owned account, not a person's. Losing the person must not lose the app.

## 2. Create the accounts

| Account                                | Cost / time                                                              | Notes                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Apple Developer Program (organisation) | about USD 99 per year; days (needs a D-U-N-S number for an organisation) | App Store Connect access for the team; enable two-factor authentication for everyone                                               |
| Google Play Console (organisation)     | one-time fee; days; identity verification                                | a new personal account must run a closed test with testers for 14 days before production; organisation accounts have fewer hurdles |
| Expo organisation                      | free tier to start                                                       | create an org (not a personal account) so EAS projects survive staff changes; add the three developers                             |
| Sentry (or equivalent)                 | optional                                                                 | one project for the mobile app; copy the DSN into the EAS environments                                                             |

## 3. Wire the repository

```bash
cd apps/mobile
npx eas-cli login
npx eas-cli init                                    # creates the EAS project; prints the project id
npx eas-cli env:set --environment production --name EAS_PROJECT_ID --value <id> --visibility plaintext
npx eas-cli env:set --environment production --name EXPO_PUBLIC_API_URL --value https://<api host> --visibility plaintext
npx eas-cli env:set --environment production --name APP_BUNDLE_ID --value <bundle id> --visibility plaintext
# repeat for --environment preview and --environment development with their own API URLs
```

`EXPO_PUBLIC_*` values are public by design; do not store anything secret that way. The robot token for CI: Expo dashboard → Access tokens → create a token for a robot user; add it to GitHub as the secret `EXPO_TOKEN`. Then create two GitHub Environments, `mobile-preview` and `mobile-production` (Settings → Environments), with required reviewers: the `Mobile release` workflow waits for their approval before it builds, submits or publishes anything.

## 4. Credentials

Let EAS manage signing: `npx eas-cli credentials` (it generates the iOS distribution certificate and provisioning profiles through your Apple login, and the Android keystore). The Android upload key and the Apple App Store Connect API key are
stored in EAS; **download and keep a backup of the Android keystore somewhere the company controls** (losing it can strand the app). Never commit them (`.gitignore` blocks the common extensions).

## 5. First builds and the listing

1. `eas build --profile preview --platform all` and install the results on your own phones: this proves signing works.
2. Create the app in **App Store Connect** and **Play Console**; complete: name, description, screenshots (use the real app), category, age rating, support URL, privacy policy URL.
3. **Apple privacy nutrition labels** and **Google Data safety** forms: answer from what the app actually collects. Today: account email and name, workspace data the person views, identifiers for crash reports if Sentry is on. Every new permission or data type (camera, contacts, push token, location) changes these: the `mobile-native-capability` skill reminds you.
4. iOS: the app declares `usesNonExemptEncryption: false` (HTTPS only); confirm that is still true before each release.
5. Provide a **demo account** for reviewers (Apple and Google both ask when sign-in is required): a seeded workspace with a staff login, no real customer data, MFA off.
6. `eas build --profile production --platform all`, then submit by hand the first time (`eas submit` needs the store records to exist). Release to the internal track / TestFlight first; promote when the manual checks in the [release runbook](mobile-release.md) pass.

## 6. Ongoing

Annual renewals (Apple), Google policy updates (target API level each year: Expo SDK upgrades handle it), certificate expiry (EAS renews managed credentials), and the privacy forms whenever the data the app collects changes.
