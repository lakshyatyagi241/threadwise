# Google Play submission pack

What to type into Play Console, taken from what the app's code does (read from the code on 2026-10-22; the permission list is from a local build, see below). If the app changes, change this file with it.

## Build and upload

```bash
# 0. BEFORE the first build: the package name cannot change after the first upload to Play.
#    app.config.ts defaults to the placeholder ai.geta.crm and the name "Geta". Set the real ones first:
eas env:create --environment production --name APP_BUNDLE_ID --value <final package name> --visibility plaintext
eas env:create --environment production --name APP_NAME --value "<name under the icon>" --visibility plaintext

# 1. EAS project, then the production variables (https only; the production build refuses http)
eas init
eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://<api host> --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_WEB_URL --value https://<web host> --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_SENTRY_DSN --value <dsn> --visibility plaintext   # optional, off when empty
eas env:create --environment production --name EAS_PROJECT_ID --value <id from eas init> --visibility plaintext

# 2. Play service-account key (Play Console, Setup, API access, grant "Release manager"): give it to EAS, never to git
eas credentials --platform android      # choose "Google Service Account Key for Play Store Submissions"

# 3. build and submit
eas build --platform android --profile production      # an .aab; EAS holds the upload key
eas submit --platform android --profile production     # Internal testing track, as a draft
```

`eas.json` submits as a **draft** to **Internal testing** on purpose: Play only accepts a draft for an app with no release yet, and a person should roll a build out from Play Console after looking at it. Change `releaseStatus` to `completed` once the app has a published release if you want `eas submit` to roll out by itself.

The first upload must be by hand in Play Console if the app record has no release yet. Back up the upload key (`eas credentials`). Turn on Play App Signing.
A new personal developer account must run a closed test (12 testers, 14 days) before it may publish to Production; an organisation account does not.

## Permissions the app asks for (Android)

Read from the merged **release** manifest of a local build (`android/app/build/intermediates/merged_manifest/release/`). A bundle id of `.dev` there is only the local variant. Re-read the real list from the `.aab` before you submit (`bundletool dump manifest --bundle app.aab | grep uses-permission`) and fix this table if it differs.

| Permission                                                                                                                                                                               | Why                                                                                                                      | Play form                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`                                                                                                                                  | talk to the CRM API; know whether the phone is online                                                                    | none                                     |
| `CAMERA`                                                                                                                                                                                 | take a photo to share in a chat or attach to a contact                                                                   | none                                     |
| `POST_NOTIFICATIONS`                                                                                                                                                                     | notifications (Android 13+)                                                                                              | none                                     |
| `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `com.google.android.c2dm.permission.RECEIVE`, launcher-badge permissions (`READ_APP_BADGE`, vendor `...BADGE...` and `...launcher.permission...`) | added by the notifications library: scheduled notifications after a restart, push delivery, the unread badge on the icon | none                                     |
| `USE_BIOMETRIC`, `USE_FINGERPRINT`                                                                                                                                                       | added by the secure-storage library; the app has no biometric lock yet                                                   | none                                     |
| `VIBRATE`                                                                                                                                                                                | notification haptics                                                                                                     | none                                     |
| `CALL_PHONE`                                                                                                                                                                             | place a call to a contact straight from the app; without it the number opens the dialer                                  | none (not a restricted permission)       |
| `READ_PHONE_STATE`                                                                                                                                                                       | hear that a call placed from the app started and ended (no call log, no numbers)                                         | justify in the review notes              |
| `SYSTEM_ALERT_WINDOW`                                                                                                                                                                    | show the contact's card over the call screen while a call placed from the app is on                                      | justify in the review notes              |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`                                                                                                                                   | the service that watches one call and shows the card                                                                     | **Foreground service declaration** below |

Not in the manifest today: call log, SMS, contacts, location, microphone, storage. Only `READ/WRITE_EXTERNAL_STORAGE` are blocked in `app.config.ts`, and the microphone is switched off in the image-picker plugin; the others are absent only because no library asks for them. A new library can add one, so re-check the `.aab` manifest on every release.

### Foreground service declaration (type: Special use)

- **Task:** while a call the person placed from the app is ongoing, the app shows the contact's name and details over the phone's call screen, and when the call ends it opens the app on "log this call".
- **Why it must be a foreground service:** the call screen belongs to the phone app, so the card has to stay on screen while the app is in the background; a normal background task is killed.
- **Lifetime:** starts when the person taps Call in the app; stops itself when the call ends, when no call starts within a short wait, or when the app asks. It never runs otherwise.
- **Video for the form:** record one run: open a contact, tap Call, show the card over the dialer, hang up, show the "log this call" screen.

### `SYSTEM_ALERT_WINDOW` justification

Core feature: the contact card over the call screen for calls the person started from the app. It appears only after the person turns on "Display over other apps" for the app themselves, and the app works without it (the call still goes through; only the card is missing).

## Data safety answers

| Question                                                         | Answer                                                                                                                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the app collect user data?                                  | Yes                                                                                                                                                                        |
| Encrypted in transit?                                            | Yes (https only; production refuses http)                                                                                                                                  |
| Can users ask for deletion?                                      | Yes: in the app, Menu, Data & Security, Request for Account Deletion. Give the web page address of the same request (`/account/delete` on the web app) in the form.        |
| Personal info                                                    | Name, email address, phone number (account; and the customers' names and numbers the workspace stores). Purpose: app functionality, account management. Not shared.        |
| Messages                                                         | Chats and messages the workspace handles. Purpose: app functionality. Not shared.                                                                                          |
| Photos and files                                                 | Only those the person takes or picks to send or attach. Purpose: app functionality. Not shared.                                                                            |
| App info and performance                                         | Crash logs and diagnostics, only when `EXPO_PUBLIC_SENTRY_DSN` is set. Purpose: analytics/stability. No IP address or personal details are sent (`sendDefaultPii: false`). |
| Device or other IDs                                              | Push token, once push notifications are wired (not yet). Declare it when they ship.                                                                                        |
| Location, contacts, call log, SMS, microphone, health, financial | Not collected.                                                                                                                                                             |
| Data sold or used for ads?                                       | No                                                                                                                                                                         |

The tokens live in the Android Keystore through `expo-secure-store`, and `allowBackup` is off, so they are not copied by device backup.

## Other Play Console items (yours to supply)

- App name, short and full description, 512 px icon, feature graphic (1024x500), at least 2 phone screenshots.
- Privacy policy URL (public, https) and support email.
- Content rating questionnaire, target audience (18+, business tool), ads: none, category: Business.
- App access: give the reviewer a demo login (seeded workspace, no real customer data, MFA off, CAPTCHA off). Without it the review is rejected.
- Government/financial/health apps declarations: not applicable.
- Target API level: the release build targets 36.
