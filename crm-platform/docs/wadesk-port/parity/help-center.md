# Intended deviations from WaDesk: Help center (requested by the project owner)

[PORTING_RULES.md](../PORTING_RULES.md) says features and UI do not change, and that a deviation is allowed only when documented
and approved. The Help center is an addition: WaDesk has no counterpart for it, so there is nothing to compare screen by screen,
and the `wadesk-playwright-parity` run records "no comparable surface" for it. Every item below differs from WaDesk on purpose.
Each was requested by the project owner (Lakshya) in chat on 2026-10-04; each entry states the words. Status: **owner-requested,
pending sign-off by the domain owner and reviewer**. Design: [../../specs/help-center.md](../../specs/help-center.md).

## HC-1. A Help entry in the menu, directly above Settings

WaDesk's menu has no Help entry (it has Support and Guidebook in the user menu). Ours adds a Help icon in the pinned block under the
scrolling menu, directly above Settings, in the slim rail and in the mobile drawer. The landmark around that block is labelled
"Help and settings" instead of "Settings" because it now holds both. The user menu's Support and Guidebook entries are untouched.

Owner's words: "we can place this document page as a icon in main menu just above setting icon as may be help".

## HC-2. In-app guides, one per feature, that follow the plan

WaDesk's Guidebook is a set of operator-written articles shown to everyone (`GuidebookArticle`, `/guidebook`); it is a separate
feature and stays on the port list as it is. The Help center is different: guides are checked-in markdown, one per screen, Settings
tile or plan feature, and a guide is shown only to a workspace whose plan and role include the feature. When a plan feature or a
module is switched off, its guides, search hits and tips disappear on the next page load, and a direct address returns a 404.

Owner's words: "start preparing the document for all the features, now this features should be the one activated for a plan, incase
if we disable any module or feature then the document related to it should also go".

## HC-3. A "?" tip on pages and sections that links to the guide

A question-mark button in the top bar opens a short summary of the screen you are on and a link to its guide. A section-level
`HelpTip` does the same beside a control. Neither exists in WaDesk. A tip renders nothing when its guide is not visible to the person.

Owner's words: "Add tooltips to relevant section, peage etc and linlk that to the document page".

## HC-4. Guides are kept complete by the workflow, not by hand

A coverage test fails when a built screen, Settings tile or plan feature has neither a guide nor an owned entry in
`help-center/pending.json`; a post-merge hook and a session-start note list undocumented features after a pull, and the
`help-docs-sync` skill drafts them. This is a team process, not a screen, so there is nothing to compare.

Owner's words: "who so every build anything and if I take the pull then we make document of that pending items too automatically".

## HC-5. One help screen: the guidebook layout, with how-to guides written for this build (owner request 2026-10-05)

`/help` now has the layout WaDesk's Guidebook has (header band with "Ask support", a category rail with a count per area and "Need a human?
Contact support", a search card with popular guides, cards with area, minutes to read and "Read guide") instead of two help screens.
The categories are our areas (Platform, Inbox & Chat, CRM, ..., Getting started, plus a new Troubleshooting). The guidebook's sample
articles were not copied, because most describe pages and behaviour this build does not have; each topic was checked against the code
and written as a native guide only when it exists (connecting a number, inviting teammates, CSV import, moving from another platform,
the four template topics, campaign A/B, stop and resume, read rate, scheduled and recurring sends, segments and bulk tag, first flow,
flow run log, stuck messages, receipts, missing incoming messages, two-step lock-out, message billing). Skipped because the build has no
such feature: outbound webhook signature, timeouts and replay, auto-reply rules (cooldown, fuzzy match, hours), a stored payment method.

Not decided yet: what happens to `/guidebook` and its operator editor (`/admin/guidebook`, with helpful/not-helpful votes).
