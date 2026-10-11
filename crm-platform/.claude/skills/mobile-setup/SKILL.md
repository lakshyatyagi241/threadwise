---
name: mobile-setup
description: >-
  Get a developer running on the mobile app (apps/mobile) for the first time, or diagnose "the app won't start": checks Node/pnpm, builds the shared
  packages the app imports, creates .env, verifies the API is reachable the way a phone reaches it, and walks through the first development build on an emulator
  or a device. Use when someone says "set up the mobile app", "run the app", "first time on mobile", "Metro can't find @crm/contracts", "can't reach the server
  from the emulator", "Expo Go doesn't work", or "I have no Mac". Read-only diagnosis by default; it changes nothing except the files it says.
---

# Mobile setup

Full guide: `docs/runbooks/mobile-local-development.md` (written without a device: fix it where it is wrong). Run the diagnostic first:

```bash
bash .claude/skills/mobile-setup/scripts/doctor.sh
```

It checks: Node matches `.nvmrc`, pnpm 9, dependencies installed, `@crm/tax` and `@crm/contracts` built, `apps/mobile/.env` present with an `EXPO_PUBLIC_API_URL` that is a URL, whether the API answers at that URL **from this computer**, and the Android tooling (`ANDROID_HOME`, `adb`).
It prints what to do for each failure and changes nothing.

## Then, in order

1. Install and build: `pnpm install`, `pnpm --filter @crm/tax build && pnpm --filter @crm/contracts build`.
2. `.env`: `cp apps/mobile/.env.example apps/mobile/.env`; set `EXPO_PUBLIC_API_URL` for where the app will run (emulator `http://10.0.2.2:3000`, iOS simulator `http://localhost:3000`, real phone `http://<LAN IP>:3000`).
3. Backend: the `setup` skill brings up Docker, migrations, seed and the API (`pnpm dev` on port 3000).
4. A development build (Expo Go cannot run this app): Android locally with `pnpm --filter @crm/mobile android` (needs Android Studio), or in the cloud with `cd apps/mobile && npx eas-cli build --profile development --platform android|ios`. No Mac? iOS goes through EAS; develop on Android meanwhile.
5. `pnpm --filter @crm/mobile start`, open the installed "CRM (Dev)" app, sign in with a seeded account (`docs/runbooks/local-development.md`). Seeing "Hello, <name>" proves token storage, the API client and contract parsing.
6. `bash .claude/skills/mobile-pre-pr/scripts/gate.sh` should pass on a clean checkout. If it does not, that is the first thing to fix.

**Windows and OneDrive:** a checkout under `OneDrive\Desktop` makes Gradle and Metro slow and fragile (sync locks, long paths). Move it to a short local path like `C:\src\wadesk-port` or exclude it from sync; enable Windows long paths.

Creating the Expo account, running `eas init`, and building through EAS spend the owner's accounts and quota: do them only when the user asks.
