# Account gates (the lock screens)

After sign-in the API refuses most routes to an account that has one thing left to do. `GET /v2/auth/session` says which with `flags`, and
the signed-in layout (`src/app/(app)/_layout.tsx`) shows the matching lock screen **instead of the app**: nothing else is mounted, so no
screen asks for data that can only be refused and no live connection is opened. Each screen leaves by itself when the session says its gate
is open. The order is the API guard's (`account-gate.guard.ts`) and the web's (`gate-target.ts`).

| Gate (flag)                              | Screen              | What the person does                                                                                          | API (all `@AllowWhileGated`)                          |
| ---------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `suspended`, or `WSP_ORG_SUSPENDED` seen | `suspended-view`    | reads who to ask; **Check again** reads the session again; **Sign out**                                       | `GET /auth/session`                                   |
| `passwordChangeRequired`                 | `password-view`     | current password, new password (live rule checklist), confirm; the server names a broken rule or the field    | `POST /account/password`                              |
| `mfaEnrolmentRequired`                   | `mfa-view`          | opens the authenticator app (the `otpauth` link) or types the key by hand, enters the first code, saves codes | `POST /account/mfa/setup`, `POST /account/mfa/enable` |
| `emailBlocked` (policy "block")          | `verify-email-view` | resends the mail (one a minute, countdown), **I've verified my email** reads the session again                | `POST /auth/verify-email/resend`                      |

Decision code: `src/lib/session/account-gate.ts` (`gateOf`, and `noteGateError`, called by the query cache for every failed call: a gate
error re-reads the session so a gate that closes while the app is open takes over at once; `WSP_ORG_SUSPENDED` is remembered in memory
because a suspended workspace is not a session flag). `use-account-gate.ts` adds the one thing the flags cannot say.

## Things to know

- **Recovery codes** are shown once, and enrolling ends the "required" gate at once. A refresh of the session (switching to the authenticator
  app and back does one) must not take the codes away unsaved, so they are held in memory (`recovery-codes-store.ts`) and keep the screen up
  until the person confirms they saved them. Never stored, never logged, dropped on sign-out. There is no clipboard library (a native library
  needs a new build), so the codes and the key are selectable text and **Share codes** opens the phone's share sheet.
- **The key** is not a QR code to scan (the phone cannot scan itself): the button opens the authenticator app with the `otpauth` link; a
  phone with no such app is told so and can type the key.
- **Reauth.** A session that signed in more than ten minutes ago must send the password to start or finish enrolment
  (`AUTH_REAUTH_REQUIRED`); it is asked for, kept in memory only, and dropped once it has worked.
- **No server-side idempotency** on these routes, on purpose: the client sends a key with every POST, but the API honours it only on `@Idempotent`
  routes and the account routes are not, so the authenticator key and the recovery codes are never stored for a replay. Do not mark them.
- The password-change answer (`{ revokedOtherSessions }`) has no contract in `@crm/contracts` (the web declares it locally), so the app does not
  read the body: a 2xx is success and the next read of the session shows the flag cleared.

## Not built here (recorded, not dropped)

| What                                                 | Why it waits                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Workspace onboarding (`landing: onboarding`)         | a three-step wizard with a paid-plan choice (web `(gate)/onboarding`): its own piece of work. The dashboard shows an info banner meanwhile |
| The "verify your email" banner (policy `banner`)     | the web nags with a banner; the app only handles the blocking policy                                                                       |
| Passkeys, the full security page (sessions, disable) | not a gate: the web's `/account/security` screens, to be ported with the account screens                                                   |
