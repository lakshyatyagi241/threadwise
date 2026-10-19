# Settings

The workspace's own setup, opened from the **Settings** row of the Menu tab (it expands like Dashboard and Contacts, and is faded only when
the person may open nothing in it). Each line opens with the right that manages it, as on the web.

| Line            | Route                                 | Right                                                          | API                                                                                                      | Web                                                  |
| --------------- | ------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Saved replies   | `/quick-replies`, `/quick-reply-form` | `inbox.savedreply.manage`                                      | `/v2/inbox/saved-replies` (list, one, create, update, delete, duplicate)                                 | TW-TIB1-024, Settings, Saved replies                 |
| Labels          | `/labels`, `/label-form`              | `inbox.tag.manage`                                             | `/v2/inbox/labels` (list, create, update, delete)                                                        | Settings, Conversation tags                          |
| Business hours  | `/business-hours`                     | `inbox.settings.read` to see, `inbox.routing.manage` to save   | `GET`/`PUT /v2/inbox/routing/business-hours`                                                             | Auto-assignment, Business hours dialog (TW-TIB2-004) |
| Auto-assignment | `/auto-assignment`                    | `inbox.settings.read` to see, `inbox.routing.manage` to change | `/v2/inbox/routing/rules` (list, reorder, one, switch, copy, delete), `/settings`, `/v2/inbox/assignees` | Auto-assignment (TW-TIB2-001; Geta: Chat assignment) |

## Saved replies

The workspace's library of reusable replies an agent inserts in a conversation (the inbox's reply picker reads the same library; a change
here refreshes it). The app calls it "Saved replies" like the web and like the inbox's own picker; the Geta app's route name is
`quick-replies`, which is the route name here.

- **List**: newest first, 30 at a time. Tabs **All / Shared / Mine** with the server's counts; a search box (shortcut, title, text); the dots on a
  row offer **Edit** (when the API says `canEdit`), **Duplicate** and **Delete** (asks first, and says whether everyone or only the person loses
  it). A shared reply the person may not change says why instead of opening. A plan with a limit shows how much is used (a bar), warns at 80%
  and stops offering **add** at the limit; creating or copying past it answers `PLAN_LIMIT_REACHED`.
- **Form**: shortcut (shown the way the server stores it: "Agents type /thank_you"), title, text with **variables** that insert at the cursor and
  a live **preview** with sample data (anything the preview cannot fill stays as written and is listed), category, language, the channels it is
  meant for (none ticked: every channel), and who can use it. Scope is chosen once: a reply cannot change between shared and personal after it
  is saved. The checks are the contract's (`normalizeShortcut`, the schemas, `renderSavedReply`, `sampleVariableLookup`), so the app and the
  server cannot drift.
- **Errors by code**: `SAVED_REPLY_SHORTCUT_TAKEN` (under the shortcut), `PLAN_LIMIT_REACHED`, `ROW_VERSION_CONFLICT` (the form reloads the other
  person's version and asks for a review), `SAVED_REPLY_NOT_EDITABLE`, `SAVED_REPLY_NOT_FOUND`, `VALIDATION_FAILED` (by field).

### In the web, not built here (recorded, not dropped)

| What                               | Why it waits                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| Import and export (CSV)            | needs a file picker and a file save (`mobile-native-capability`, a new build); the API has both     |
| "Created by", "last used" on a row | the API sends them (`createdByName`, `lastUsedAt`); the row shows the use count only, to stay short |
| A category filter                  | the API filters (`category`) and lists them (`categories`); the search box covers the common case   |
| "Used for this channel" filter     | the API filters by `channelKind`; not needed on a phone's one list                                  |

## Labels

The workspace's label library (the web calls them "conversation tags" and has retired the word "labels"; the app and the Geta app say
"Labels", and so does the inbox, so Settings does too). The same rows are the contacts' tags, which is why deleting one also takes it off
contacts, and the delete dialog says so.

- **List**: every label with its colour dot, description and how many conversations carry it (the library is small and comes whole). A row opens
  to edit, the bin deletes after asking, the round button adds. A label deleted by someone else meanwhile counts as deleted.
- **Form**: name (stops typing at the server's 64), colour (ten swatches in the theme tokens, or any hex colour or colour name typed in; a
  stored colour the phone cannot draw falls back to the default dot), and an optional description (emptying it clears it). There is no route
  for one label, so the edit form finds it in the library list and says so when it is gone.
- **Errors by code**: `CON_TAG_NAME_TAKEN` (under the name), `ROW_VERSION_CONFLICT` (the form reloads and asks for a review), `PLAN_LIMIT_REACHED`,
  `VALIDATION_FAILED` (by field).
- A change refreshes the inbox's own copy of the library (its label pickers and filters).

## Business hours

The weekly opening hours and the time zone that the routing condition "outside business hours" and the SLA clock read (the web's dialog of
the Auto-assignment screen; the same screen the app will use for Chat assignment). The whole route family needs the plan feature
`inbox_routing`: on a plan without it the screen says so (`PLAN_FEATURE_LOCKED`, reads included) instead of showing a form.

- **Days**: seven cards, each with a checkbox (a day switched off is closed all day) and From / To. Times are typed as digits and the colon
  is put in (the app has no native time picker, as in the task form): `0930` becomes `09:30`. 24:00 closes at midnight and a closing time before
  the opening one is an overnight window, as on the server. Mistakes are named under the day: both times are needed, a time is not a time of day,
  or opening and closing are the same.
- **Time zone**: shown to everyone, changed only by the workspace owner (the API says `canEditTimezone`), from the phone's own list of zones
  (a short list of common ones where the phone has none). It is one long list without a search box.
- **Saving** replaces the seven days and sends the zone only for the owner. A break or a second window set on the web (the `extra` of a day) is
  carried through a save untouched, and the holidays are left out of the request so the server keeps them.
- A person with only `inbox.settings.read` sees the hours and cannot change them (fields off, no Save).

### In the web, not built here (recorded, not dropped)

| What                                                                          | Why it waits                                                                                                   |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Breaks, overnight windows, holidays (web: Settings > General > Working hours) | a different web screen (`updateWorkingHoursSchema`); the contract carries them, this screen does not edit them |
| A search box in the time zone list                                            | `SelectField` has none; the owner can scroll the list                                                          |

## Auto-assignment

The rules that give each new conversation to the right agent, tried in order from the top, and the one setting that keeps a returning contact
with their agent (the web's Auto-assignment screen; the Geta app calls it "Chat assignment"). The whole route family needs the plan feature
`inbox_routing` (the screen says so on a plan without it) and the rights `inbox.settings.read` (see) and `inbox.routing.manage` (change).

- **The setting**: "Keep returning contacts with their agent" (`keepContactAgent`), a switch.
- **Business hours**: a button to the Business hours screen (the routing condition "outside business hours" and the SLA clock read it).
- **The rule list**: a page of 50 at a time, searchable by name. Each card shows the rule's name and description, whether it is Active, the
  Fallback, "Keeps checking" (`stopOnMatch` off), how many of its agents are unavailable, **When** (contact conditions counted, channels, words
  with any/all, languages, inside/outside business hours, or "every conversation nobody matched"), **Assign** (the strategy and the agents and
  teams by name, "an agent" for any the person may not read), and the other actions (spam, priority, auto-reply, escalation, tags, a flow, with a
  note when the flow is off or deleted), then how often it fired and when it last did.
- **Changing a rule**: a switch (if someone else changed the rule first, the new version is read and the switch is tried once more, as the web
  does), two arrows that swap it with its neighbour (only on the full list, not while searching), **Duplicate** (the copy goes last, switched
  off, and counts against the plan's limit) and **Delete** (asks first). The plan's limit is shown and said when reached.
- The names come from `/v2/inbox/assignees` (needs `inbox.conversation.read`).

### In the web, not built here (recorded, not dropped)

| What                                | Why it waits                                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Creating and editing a rule         | the web form is large (conditions, strategy, escalation, auto-reply, tags, flow): its own step (see below) |
| The link to Record assignment rules | a different web screen (assigning contacts, companies and deals to sales owners), not built in the app     |

## Not built yet

Users and teams (`/v2/workspace/members`, `/v2/workspace/teams`), then the rule editor for Auto-assignment.
