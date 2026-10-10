# Mobile security rules

The mobile app runs on a device the company does not control. These rules are the ones a reviewer (and `mobile-quality-review`) checks. The reasoning for the auth parts is in [ADR-0023](../adr/0023-mobile-authentication.md).

## Credentials and sessions

- Tokens exist in two places only: the in-memory copy in `lib/auth/session-manager.ts` and one keychain item written by `lib/auth/token-store.ts`. No other file reads or writes a credential.
- No AsyncStorage / MMKV / files for anything secret (ESLint blocks the imports). Persisting any customer data on disk needs an ADR (encryption first).
- A token, a password, a code or a challenge/selection token never appears in a log, a breadcrumb, an error report, a URL, a deep link or a screenshot-able debug screen. `log.*` takes short structured fields only.
- Sign-out clears the keychain, memory and the query cache. A new screen that holds server data in its own state must clear it on sign-out (use the query cache).
- Never ship a secret. Everything in the bundle is public. `EXPO_PUBLIC_*` names that look like secrets fail `pnpm env:check`. Provider keys, signing keys and tokens stay on the server or in EAS / GitHub secrets.

## Network

- Production traffic is `https://` only (`app.config.ts` fails a production build otherwise). Cleartext is allowed for the development variant against a local API, and only there (iOS local-networking exception, Android cleartext flag).
- Every call goes through `apiFetch`; every answer is parsed with its contract schema; errors are handled by `code`.
- Do not trust server-sent URLs blindly: open links with `Linking`/`expo-web-browser` only after checking the scheme is `https` (and the host, for anything that carries a token).
- Certificate pinning is not used. If a threat model asks for it, it is an ADR (pinning breaks on certificate rotation and needs an update path).

## Device and platform

- Android `allowBackup` is off; iOS keychain items are `…THIS_DEVICE_ONLY`.
- Request the narrowest permission at the moment of use, with the explanation string translated. Every permission and every new data collection updates the store privacy answers (`mobile-native-capability` skill).
- Deep links: the app's scheme (`crm`, `crm-dev`, `crm-preview`) opens screens only; a link never performs an action (no "delete", "send" or "approve" through a URL) and never carries a token.
- Clipboard, screenshots and the app-switcher snapshot may show customer data. Hide sensitive screens in the switcher once the product defines which are sensitive (backlog).
- WebViews are avoided. If one is unavoidable it loads only allow-listed `https` origins, with JavaScript off unless needed and no bridge to native code.

## Dependencies and builds

- Libraries come from the Expo SDK set where possible (`npx expo install`). Each new dependency is read before it is added: maintainer, last release, install scripts, native code, permissions it adds.
- `pnpm audit --prod --audit-level=high` (the repo's CI step) covers the app's production dependencies.
- Build and signing credentials live in EAS. A `.p8`, `.p12`, `.jks`, `.keystore` or `.mobileprovision` in the working tree is a leak; they are gitignored.
- The robot token for CI (`EXPO_TOKEN`) has the narrowest role the Expo organisation allows and is rotated when anyone with access leaves.

## Reporting a problem

A suspected vulnerability in the app is reported to the project owner privately, not in an issue, a PR comment or chat.
