---
name: i18n-translate-sync
description: >-
  Translate every new or changed user-facing text into all 21 locales before a change is done. Use this after adding or
  editing ANY key in apps/web/messages/en/*.json, any new screen, tile, error text, email or notification copy, and whenever
  someone says "translate", "add the locales", "i18n", "missing keys", "21 languages", "RTL", "hardcoded text", "move text
  into i18n", or an i18n gap check fails. English is the source; es, hi, ar, pt, ru, ja, de, fr, it, ko, zh-CN, tr, id, vi, th,
  pl, nl, ur, he and bn must have the same keys with real translations (never English copied over, never empty). Never tell the
  user a feature is done while its English keys have a gap in any locale.
---

# i18n translate sync (mandatory)

**Rule:** every key you add or change in `apps/web/messages/en/` ships in the same change with a translation in all 20 other
locales (`apps/web/scripts/.locales.json`). No user-visible text lives in a component as a literal: it is a message key
(`useTranslations` / `getTranslations`). The gate (`pre-pr`) runs `check.sh` and fails when a message file you touched has a gap.

## Steps

1. **Put the text in English first.** Add the keys to `messages/en/<file>.json`. Use ICU arguments (`{count}`, plural/select) and
   rich tags (`<b>..</b>`) rather than gluing strings; translators need whole sentences.
2. **Find what is missing.**
   ```bash
   cd apps/web
   node scripts/i18n-audit.mjs gaps          # per locale, per file: how many keys are missing or still English
   node scripts/i18n-audit.mjs hardcoded     # English literals still sitting in components
   ```
3. **Plan the batch.** `node scripts/i18n-tool.mjs plan 3000` writes `/tmp/i18n/in/<locale>/NN.json`: a flat
   `{"file.json::dotted.key": "English"}` of exactly the keys that locale lacks.
4. **Translate** each file into that locale (keep the keys, change only the values). Rules for the values:
   - keep every ICU argument name and rich tag exactly (`{name}`, `{count, plural, ...}`, `<b>`); the validator rejects drift;
   - keep product names, code, `{{variables}}`, URLs and placeholders such as `{{contact.name}}` untouched;
   - natural wording for the UI (short imperatives for buttons), not word-for-word;
   - `ar`, `he`, `ur` are right-to-left: text only here, layout uses logical properties (`ms-`/`me-`, `start`/`end`), never `left`/`right`;
   - fan the locales out to sub-agents in parallel (one locale per agent) when there are many keys.
5. **Apply and validate.** `node scripts/i18n-tool.mjs apply <locale> /tmp/i18n/out/<locale>.json` merges and validates (same
   arguments and tags as English, non-empty, no leftover keys). Then `node scripts/i18n-tool.mjs check` re-validates everything on disk.
6. **Prove it.**
   ```bash
   bash .claude/skills/i18n-translate-sync/scripts/check.sh
   ```
   It fails if any `messages/en/*.json` file changed in your branch has a missing key or an untranslated English copy in any
   locale, and prints the exact reproduce commands. The legacy backlog in files you did not touch does not fail it.
7. Add a test or snapshot only if the text is built from catalogue ids; component tests mock `next-intl`
   (`vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))`).

## What counts as untranslated

A value equal to the English source (except names, numbers, symbols, `{{vars}}`, and the allowlist the audit prints), an empty
string, or a key missing from a locale. `i18n-audit.mjs gaps` reports all three.

## Backlog

Files nobody touched may still have gaps. When asked, clear them with steps 2 to 5 using
`gaps --strict` as the finish line.
