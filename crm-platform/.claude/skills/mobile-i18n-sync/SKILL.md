---
name: mobile-i18n-sync
description: >-
  Keep the mobile app's text translated: add or change a key in apps/mobile/src/messages/en.json and write it into the other 21
  locales (ar bn de es fr he hi id it ja ko mr nl pl pt ru th tr ur vi zh-CN), then run the completeness check. Use after ANY mobile
  change that adds, edits or removes visible text, an error message, an accessibility label, a notification or a store/permission string, and
  whenever i18n:check fails. English-only is never done. Never leave a literal string in a component or copy English into another locale.
---

# Mobile translations

Rules and the lint that backs them: `docs/mobile/i18n.md`. Files: `apps/mobile/src/messages/<locale>.json`; `en.json` is the source and the type of every `t()` key.

## Steps

1. **English first.** Add or change the key(s) in `src/messages/en.json`, grouped by feature (`inbox.emptyTitle`). Short, plain, no jargon, no trailing technical detail. `{{name}}`-style placeholders for values; never build sentences by concatenating translated pieces. Counts use plurals (`key_one`, `key_other`, plus `_zero/_two/_few/_many` where the language needs them: Arabic, Polish, Russian have more categories).
2. **Use it** in the component with `t('group.key')` (typed; a typo is a compile error).
3. **Write the other 21 files.** Add the same keys to every file in `src/messages/`, in the same position. You do the translating: write natural, idiomatic text for each language (not a literal word-for-word rendering), formal-neutral tone as in the existing strings, the product's own terms as the web app's message files translate them (look up the same concept in `apps/web/messages/<locale>/` and reuse that wording, so the web and the app say the same thing). Keep every `{{placeholder}}` byte-identical. Right-to-left languages (ar, he, ur) need no markup.
4. **Run the check:**
   ```bash
   pnpm --filter @crm/mobile i18n:check
   ```
   It fails on: a locale file missing, a key missing or extra, an empty value, a value still equal to English, a changed placeholder.
5. **Legitimate same-as-English words** (a loanword such as "Password" in Italian, "Email" in Vietnamese) go in `apps/mobile/scripts/i18n-same-as-english.json` as `{ "it": ["auth.password"] }`. Never use that file for text you did not translate.
6. **Look at it.** Typecheck (`pnpm --filter @crm/mobile typecheck`) and, for a screen, view it in one long language (German, Russian) for overflow and one right-to-left language (Arabic) for mirroring.

## Notes

- Server messages (`ApiError.message`, problem `title`/`detail`) are English and not for display; show text chosen by error code.
- Permission-usage strings (iOS Info.plist, Android permission rationale) are text too: put them in the message files when shown in-app; the native strings in `app.config.ts` are English unless localised with `expo-localization` config (see `mobile-native-capability`).
- Dates, numbers and money use `Intl` with the active locale, never hand-formatting.
- A removed screen's keys are removed from all 22 files in the same change (the check fails on extras).
