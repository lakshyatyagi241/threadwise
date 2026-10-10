---
name: mobile-new-screen
description: >-
  Add a route and screen to the mobile app (apps/mobile): a new file in src/app, a feature folder in src/features, the loading, empty,
  error and permission-denied states, and the shared components. Use this whenever asked to "add a screen", "new page in the app",
  "add a tab", "list screen", "detail screen", "form screen" or "modal" in the mobile app, or when mobile-feature-port reaches the
  build step. Enforces the layering (app → features → components → lib), thin route files, the shared Text/TextField/Button/Screen,
  theme tokens and accessibility. Never put logic in a route file or import one feature from another.
---

# Add a screen

Layers and why: `docs/adr/0024-mobile-app-architecture.md`. The tooling (`pnpm --filter @crm/mobile lint` and `arch`) rejects the common mistakes, and its messages name the fix.

## Steps

1. **Pick the feature folder.** `src/features/<area>/` (kebab-case, one per product area: `inbox`, `contacts`). Reuse an existing one for the same area. A screen needing something from another feature moves that thing down into `src/components/` or `src/lib/`.
2. **The route file** in `src/app/` is one line that re-exports the screen: `export { InboxScreen as default } from '@/features/inbox/inbox-screen';`. Group `(app)` is for signed-in screens, `(auth)` for signed-out. Dynamic routes: `src/app/(app)/contacts/[id].tsx`; read params with `useLocalSearchParams`. Use `Link`/`router` from `expo-router` (typed routes are on).
3. **The screen** `src/features/<area>/<name>-screen.tsx` composes `Screen` (or a `FlatList` for server lists) and the shared UI from `@/components/ui`. Hooks for data live next to it (`use-<thing>.ts`, see `mobile-api-call`). One screen, one reason to change; split big ones into components in the feature folder.
4. **Every screen has all of these states**, and a test for each:
   - loading (an `ActivityIndicator` with an accessibility label from `t()`);
   - error (the message from `messageForError`/the screen's own code map, plus a "Try again" button);
   - empty (a sentence and, when the person can act, the action);
   - permission denied / feature off (read `useSession().data.permissions`; the API enforces regardless, the screen just does not offer what the person cannot do);
   - the content.
5. **Lists** over server data: `FlatList` with `keyExtractor`, `useInfiniteQuery` (`getNextPageParam: (last) => last.page.hasMore ? last.page.nextCursor : undefined`), `onEndReached`, pull-to-refresh (`refreshing`/`onRefresh`), a stable row height or `getItemLayout` when possible. Never `ScrollView` + `.map` for data that can grow. Add `@shopify/flash-list` (via `npx expo install`) when the first long list lands.
6. **Forms:** controlled inputs with `TextField`; validate with the contract schema's `safeParse` and show field messages from `t()`; disable the submit while pending; send mutations with an idempotency key; map `ROW_VERSION_CONFLICT` to a "changed elsewhere, reload" message.
7. **Styling:** `useTheme()` for colours, `spacing`/`radius`/`typography` from `@/lib/theme/tokens`. No hex values, no fixed pixel widths for text containers (font scaling), `marginStart/End` instead of left/right (RTL). Respect safe areas (`Screen` does).
8. **Accessibility:** every pressable has a role and a name (the shared `Button` does); tap targets ≥ 48; images have `accessibilityLabel` or are marked decorative; focus order follows reading order; errors use `accessibilityRole="alert"`.
9. **Text:** only through `t()` (invoke `mobile-i18n-sync`). Headings use `accessibilityRole="header"`.

## Then

Invoke `mobile-test` for the tests, `mobile-quality-review` before the PR. Run the screen on an emulator or device, with a large font and dark mode, and say so in your report.

## Never

Logic in a route file; `import … from '../…'` (use `@/`); `Text`/`TextInput` from `react-native`; literal text; a screen that works only when online data is present without an error state; a new global store (ADR-0024).
