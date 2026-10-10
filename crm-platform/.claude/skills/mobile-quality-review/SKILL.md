---
name: mobile-quality-review
description: >-
  Review a mobile change (apps/mobile) for the things lint and tests cannot catch, before opening a PR: accessibility (screen readers, tap
  targets, font scaling, contrast, RTL), performance (list rendering, re-renders, startup, images, bundle size), security and privacy (tokens, logging,
  storage, deep links, permissions, store privacy answers), offline and error behaviour, and App Store / Play policy risks. Use after building a screen
  or feature, when asked to "review the mobile code", "is this accessible", "check performance", "will the store accept this", and as the step before mobile-pre-pr.
---

# Mobile quality review

Run the diff through this list. For an independent read, also dispatch the `mobile-reviewer` subagent with the diff (not with your conclusions). Report each finding as `path:line: severity: problem. fix.` and fix the real ones.
Get the diff with `git diff main...HEAD -- apps/mobile packages/contracts` plus uncommitted changes.

## Accessibility

- Every interactive element has a role and an accessible name from `t()`; icon-only buttons have labels; images are labelled or marked decorative.
- Tap targets ≥ 48 (use `MIN_TOUCH_TARGET`); no tiny close icons without a larger hit area (`hitSlop`).
- Layout survives the largest system font (no fixed heights on text containers, no `allowFontScaling={false}`, no clipped text); the screen scrolls when content grows.
- Contrast: colours come from the tokens; if you introduced a colour pair, check 4.5:1 for body text, 3:1 for large text and controls, in light and dark.
- Screen-reader order follows reading order; headings are `accessibilityRole="header"`; errors are `alert`s; loading states announce; state (selected, disabled, busy, checked) is exposed through `accessibilityState`.
- Right-to-left: `start`/`end` spacing, icons that imply direction mirror, no hard-coded left/right.
- Reduced motion respected for any animation (`useReducedMotion`).
- Actually used with VoiceOver (iOS) or TalkBack (Android) through the main flow when the change is a screen. If not run, say so.

## Performance

- Server lists are `FlatList`/FlashList with `keyExtractor`, memoised row components where rows are non-trivial, no inline object/array props that defeat memoisation in rows, no work in render that can be derived once. The React Compiler is on, but it does not fix a list built from a `ScrollView`.
- No request in a loop, no waterfall where requests are independent (`useQueries`), no refetch storm (sensible `staleTime`), `select` to derive instead of copying into state.
- Images: sized to what is shown, cached (use `expo-image` when images arrive), no full-resolution photos in lists.
- Startup path (`src/app/_layout.tsx`) does only what the first screen needs; no heavy imports at module scope.
- Bundle: `pnpm --filter @crm/mobile bundle:check` prints sizes; a PR that grows the bundle by more than 10% explains why. A new dependency's size and its transitive native modules were looked at.
- Animations on the UI thread (Reanimated, native driver), not state-driven re-renders.

## Security and privacy (`docs/mobile/security.md`)

- No token, password, code, message body, phone number or email in logs, breadcrumbs, error reports, URLs, deep links, `testID`s or fixtures; test data is fake.
- No new storage of customer data on disk; no AsyncStorage/MMKV; credentials only through `lib/auth/token-store`.
- All requests through `apiFetch`; responses parsed; no `any`; no `eslint-disable`/`@ts-ignore` without a stated reason; no `process.env` outside `config/env.ts`; no secret in an `EXPO_PUBLIC_*`.
- Links opened only if `https`; deep links open screens, never perform actions; WebViews avoided or locked down.
- Permissions: narrowest, requested at point of use, with a specific translated reason; a denied permission leaves the app usable.
- The store privacy answers (Apple labels, Google Data safety) still match what the app collects; if the change adds a permission, SDK or data type, note it for the owner.

## Behaviour

- Offline: the screen shows a clear state and recovers when the connection returns (no infinite spinner, no lost input in a form).
- Every API error code the endpoint can return is handled or deliberately falls to the generic message; `ROW_VERSION_CONFLICT`, 429 with `retryAfterSeconds`, 403 permission, and the account-gate codes are considered.
- Sign-out and workspace switch leave no previous data on screen or in the cache.
- Same data, permissions and states as the web screen (ADR-0027); intentional differences are stated.

## Store policy risks

Sign-in required without a reviewer demo account; "Sign in with Apple" missing next to other social logins on iOS; account deletion not available in-app when accounts can be created in-app (both stores require it); a permission without a feature that needs it; user-generated content without reporting/blocking
(if the app ever hosts any); hidden or remotely switched behaviour that changes what the app does after review (OTA rules, ADR-0026); encryption export answers.

## Then

`mobile-pre-pr`.
