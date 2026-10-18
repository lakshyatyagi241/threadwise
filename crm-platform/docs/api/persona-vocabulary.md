# Dynamic object naming ("Words we use")

Backlog BL-310 (the early, safe slice of persona phase P5, BL-280). Spec: [../specs/persona-profiles.md](../specs/persona-profiles.md) sections 7.4 and 8.2.
Wiring map: [../threadwise-port/wiring/persona-profiles.md](../threadwise-port/wiring/persona-profiles.md). Help guide: `apps/web/src/features/persona-vocabulary/help/workspace-words.md`.

A workspace can call a **contact** a Patient, Client, Lead or Member, an **appointment** a Visit, a **deal** an Admission and a **meeting** a Consult,
per language. It is a **label overlay on the web UI** and nothing else:

- The API, the data model, the public API, webhooks, exports, CSV headers, enums and permission keys keep the canonical names. No migration.
- One system for every kind of business (product direction): no concept is renamed globally and no persona gets its own code path.
- A workspace with no words (the `generic` persona, no overrides, a language it did not name) shows **exactly today's strings**: the layout hands the
  very same messages object to the provider, and a test holds that for all 21 languages.

## Where the words come from

`workspace overrides > operator overrides > persona`, per noun and language (`resolveNouns` / `explainNoun` in `@crm/contracts`, spec 6.1). The persona
layer is all-or-nothing per language. Nothing in the product ships a persona with words yet, so today the workspace's own layer is the one in use; the
operator layer is shown to the workspace only as a source (`operator`), never with a reason or note.

The four nouns a workspace can rename are `WORKSPACE_VOCAB_NOUNS` = `contact`, `appointment`, `deal`, `meeting`. A persona or the operator may name any
`PERSONA_NOUNS` noun, but only these four have bound message keys so far.

## `org.persona.nouns` on the session

`GET /v2/auth/session` gains one optional field inside the persona view, for every member (the words are not secret):

```jsonc
"persona": { "key": "generic", "version": 1, "rev": 4, /* ... unchanged ... */
  "nouns": {                       // language -> noun -> forms, already merged workspace > operator > persona
    "en": { "contact": { "one": "Patient", "other": "Patients" } },
    "hi": { "contact": { "one": "मरीज", "other": "मरीज" } }
  }
}
```

- **Absent** when no language has any words (a workspace with no vocabulary gets exactly the view it got before; the P0 golden session test still
  holds). Zod: `personaViewSchema.nouns` (optional).
- Languages are the app's locale codes (`en`, `hi`, `zh-CN`...). The web uses `nouns[<the person's language>]` only; words for another language never
  apply.

## `GET /v2/persona/vocabulary?locale=hi`

Permission `admin.settings.manage` (the key onboarding already uses; no new tenant key). Returns the Settings screen's rows for one language:

```jsonc
{
  "locale": "hi",
  "rev": 4,
  "personaKey": "generic",
  "nouns": [
    {
      "noun": "contact",
      "effective": { "one": "मरीज", "other": "मरीज" }, // what is shown now, or null for the product's own word
      "source": "workspace", // workspace | operator | persona | default
      "workspace": { "one": "मरीज", "other": "मरीज" }, // the workspace's OWN words in this language, or null
      "workspaceLocales": ["en", "hi"], // languages in which the workspace has set its own words
    } /* appointment, deal, meeting */,
  ],
}
```

The product's own words are not sent: the web has them in its messages (`persona-vocabulary.defaults`, one per language).

## `PUT /v2/persona/vocabulary?locale=hi`

Permission `admin.settings.manage`. Mutations take an `Idempotency-Key` like every other (the web sends one). Body:

```jsonc
{
  "rev": 4, // the revision the screen read; stale = 409 ROW_VERSION_CONFLICT
  "nouns": {
    "contact": { "en": { "one": "Patient", "other": "Patients" }, "hi": null }, // a value sets that language, null removes it
    "deal": null, // null removes the noun in every language
  },
} // a noun left out is not touched
```

Returns the same shape as the `GET`. Rules:

| Rule        | Detail                                                                                                                                                                                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nouns       | Only the four above; anything else is a 422 `VALIDATION_FAILED`.                                                                                                                                                                                                                               |
| Both forms  | `one` and `other` are both required for a language (a language with one word for both numbers sends the same word twice; the screen does that).                                                                                                                                                |
| Characters  | 1 to 40 characters: letters of any script, marks, digits, spaces and `- ’ . & / ( )`. An ASCII apostrophe only inside a word. No braces, angle brackets, `#`, backslash, pipe or double quote: the text is dropped into ICU messages, so syntax characters can never reach one (`isSafeNoun`). |
| Concurrency | The row is locked, `rev` must match, a trigger bumps `rev` on every update. A save that changes nothing writes nothing (no new `rev`, no log line).                                                                                                                                            |
| Storage     | `workspace_persona.workspace_overrides.vocab` only; every other part of that document (hidden modules) and the whole operator layer are left as they are. A stored document that no longer parses is replaced by `{ v: 1, vocab }`.                                                            |
| Trail       | One `workspace_persona_log` row per noun changed (layer `workspace`, actor the user, `vocabulary.set` or `vocabulary.reset`, before and after) and one audit entry (`persona_vocabulary`). No outbox event: nothing consumes one, the session reads the row.                                   |
| No row yet  | A workspace created some other way has no persona row: the `GET` reads as `generic` with `rev` 1 and the first `PUT` creates the row.                                                                                                                                                          |

RLS is unchanged: `workspace_persona` is `tenant_isolation` (forced), the operator columns stay behind the privileged trigger, the log's append policy
binds `actor_id` to the acting user.

## How the web applies the words

1. `app/(app)/layout.tsx` already has the session. It calls `withVocabulary(messages, locale, session.org.persona?.nouns?.[locale])`
   (`features/persona-vocabulary/lib/overlay.ts`) and gives the result to its `NextIntlClientProvider`. **With no words it returns the same object it
   was given and passes no `messages` prop**, which is the code path of today.
2. With words, every string under a **bound prefix** (`lib/bindings.ts`) is rewritten (`lib/localize.ts`): the product's own singular and plural for the
   noun in that language (`persona-vocabulary.defaults`, 21 languages, checked against the real menu and button strings by a test) become the workspace's
   words, keeping the case of the original (`Contact`, `contact`, `CONTACTS`, a sentence start) and, in English, `a`/`an`. ICU arguments (`{count}`), plural
   branches and `<b>` tags are left alone; a rewrite that would change a message's arguments is dropped and the string keeps its wording.
3. Only the bound branches of the message tree are copied; the rest is shared. In production one set of words is computed once and reused.
4. `useVocabulary()` (client) gives `noun('contact').plural` / `.pluralLower` / `.singular` for text built in code, and `localize(text)` for a string that is
   not on a bound surface. Ordinary strings need neither.
5. The screen is `/workspace-words` (Settings, Business, "Words we use"). After a save it refreshes the layout, so the new words show at once.

### Why a rewrite of the translated text, not `{contact}` in the messages

About 1,450 sentences mention "contact(s)" and 21 languages inflect them (cases, gender, plural). Placeholders in every sentence would mean re-translating
all of them. The rewrite uses the wording the product already has and falls back, string by string, to it whenever it cannot be sure (spec 7.4).

### Limits (honest)

- **No grammatical agreement.** The word is placed as typed. In Spanish, French, German, Russian... an article, adjective or verb next to the noun is not
  changed; in a language with cases (Russian, Polish, Turkish, Hindi...), a form the product writes differently inside a sentence (a genitive, a dative)
  is not recognised and keeps the product's word. Check every language you rename.
- Matching is whole-word, case-insensitive; Japanese, Chinese, Korean and Thai (no spaces) match inside a run of text; Arabic and Hebrew keep a glued
  prefix (`ال`, `و`, `ب`, `ل`, `ה`).
- **A word shared by two nouns** is never renamed: Polish and Russian use one word for appointment and meeting, Hebrew too, so a rename of either is not
  shown in those languages (the screen says so; it still applies elsewhere).
- Words are applied **only for the language they were typed for**. "Use these words in every language" on the screen saves the same text for all 21.
- Server components that call `getTranslations` (page `<title>` metadata, a few Settings pages) do not see the overlay; no bound surface is rendered
  that way.
- Nothing is machine-translated. The 21-language message slice `persona-vocabulary.json` is a machine draft from English, pending native review (the
  review list is every non-English file of that slice).

## Coverage

Bound surfaces (`lib/bindings.ts`; every prefix is checked against the English messages by `overlay.test.ts`, and `bindings.test.ts` checks this page lists them):

| Surface        | Prefixes                                                                                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| contacts-menu  | `contacts-attributes-tags.nav`, `shell.nav.appointments`                                                                                                                                                                    |
| contacts-list  | `contacts-attributes-tags.list`, `.bulk`, `.kanban`, `.views`, `.form` (header, add button, search, empty and first-run states, selection banner, bulk actions, views, create and edit dialogs)                             |
| contact-record | `contacts-attributes-tags.detail`, `.contact.quick`, `.contact.header`, `.contact.record`, `.contact.nav`, `.contact.actions`, `.contact.tabs`, `.contact.details`, `.contact.meetings`, `.contact.deals`, `.contact.notes` |
| appointments   | `appointments.nav`, `.hub`, `.tabs`, `.toolbar`, `.table`, `.row`, `.calendar`, `.status`, `.drawer`, `.toast`, `.reschedule`                                                                                               |
| deals          | `deals-pipelines.nav`, `.board`, `.toolbar`, `.list`, `.card`, `.form`, `.drawer`                                                                                                                                           |

TODO, surfaces still saying the product's word (`NOT_YET_BOUND` in `lib/bindings.ts`, kept in step with this list by a test):

- Contact stages, Contact properties, Attributes, Import / export (Settings screens)
- Contact groups and Segments screens, the contact filter panel, applied-filter chips
- Inbox: conversation header, assign-to and "new contact" prompts, the right-hand contact panel
- Campaigns, broadcasts, flows and forms: audience pickers, "send to contacts" steps, node names
- Companies, Tasks, Proposals, Estimates and invoices that mention a contact, deal or appointment
- Dashboard cards, reports and analytics titles
- Notifications, the activity log, emails and WhatsApp messages the product sends
- Appointment booking types editor, public booking page, reminder templates
- Help center guides and the Help assistant
- Platform console (operator) screens
- Page title metadata (the browser tab) and any text rendered by a server component with getTranslations

Adding a surface: add its key prefix to `BOUND_SURFACES`, run the web tests (the prefix must exist in `en`, the rewrite must keep every message valid in all
21 languages), and move its line out of the TODO list here and in `NOT_YET_BOUND`. Keep customer-facing text (templates, outgoing messages) out.

## Tests

- Contracts: `vocabulary.test.ts` (safe nouns, schemas, layers, the session view), `session-view.test.ts` (an import-cycle guard).
- API: unit `persona-vocabulary.service.spec.ts` and `persona.service.spec.ts`; e2e `persona-vocabulary.e2e.spec.ts` (real Postgres, forced RLS: permission,
  revision, per-language patch, log and audit, session, two workspaces, the operator layer as a source, a broken stored document, no persona row).
- Web: `localize.test.ts` (the engine), `overlay.test.ts` (golden: identical messages for no words and for the product's own words, in all 21 languages;
  English surfaces; every rewritten message still compiles with the same arguments), `form.test.ts`, `words-screen.test.tsx`, `use-vocabulary.test.tsx`,
  `messages.test.ts` (21-language parity and arguments).

## Rollback

Delete the words from the screen (or `workspace_overrides.vocab` in the row) and the next render shows the product's words. Removing the layout lines
(`withVocabulary`) turns the feature off for everyone; nothing else depends on it.
