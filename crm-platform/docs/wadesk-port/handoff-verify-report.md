# Handoff and assignment (phase 1): browser verification report

Branch `lakshya/next/handoff-verify`, on top of `origin/main` (PRs #722, #725, #729). Scratch workspace, simulator channel, real Chromium (built-in browser pane),
API on :3960, web on :3961, Docker-free shared Postgres. Real WhatsApp delivery is NOT verified.

| # | Scenario | Result | Evidence / notes |
| --- | --- | --- | --- |
| 1a | Settings: every switch saves and survives a reload (auto-assign, claim sets owner, reassign prompt, continuity window + days, queue notification, owner modes) | PASS | Each change read back from `GET /v2/inbox/handoff-settings`; page reload shows the saved state; "Settings saved" toast |
| 1b | Settings: invalid values (0, 99999, -3, 1.5 days, unknown owner mode) | PASS | API 422; the screen clamps days to 1..365 |
| 1c | Settings: basic plan locks (no `inbox_routing`) | PASS after fix | Locked rows show "Not in your plan" + upgrade hint; API answers 422 PLAN_FEATURE_LOCKED. DEFECT D1 fixed: a downgraded workspace showed "Keep in sync" selected although the engine ignores it; now the screen shows what is in effect (saved choices come back on upgrade). Unit test `handoff-settings-effective.spec.ts` |
| 2a | Teams editor: method, default assignee, time zone, opening hours save | PASS | Saved round robin, default Ben, Asia/Kolkata Mon-Fri 09-18; read back from `GET /v2/workspace/teams/:id` |
| 3a | Simple builder: Human handoff step first/mid flow, destination team, reason, priority, note with `{{name}}`, both messages; save | PASS | Saved graph has `handoff: 2`; note resolves to the contact name on the card |
| 3b | Simple builder: publish | PASS (with a plan note) | Publishing a Simple flow saves the WhatsApp button widget first; a plan without `chatbot_widgets` gets 422 and cannot publish (pre-existing, not handoff) |
| 4a | Inbox: Waiting tab + count, "Waiting 2m" chip with priority, strip, handoff card (reason, answers, trace) | PASS | Flow fired by a simulator "hello"; conversation waiting in the Sales queue; contact received the handoff message |
| 4b | Claim race: two agents claim the same waiting chat at once | PASS | Same row version, parallel requests: one 200 (claim, `assigned_source=claim`), the other 409 "Somebody else has taken this conversation." |
| 4c | Bot muted while with a person; Return to bot resumes it | PASS | Customer "hello" while with a person: no bot reply. After Return to bot the same keyword runs the flow again |
| 3c | Exit "assigned": team round robin picks an agent, follow-up message sent | PASS | Handoff 2 assigned to Asha in Sales, `assigned_source=rule`; exits waiting (4a) and assigned verified |
| 4d | Send to queue on a chat somebody already holds | FAIL then FIXED (D2) | The dialog said "Send to queue again" but the API answered with the old assignment and changed nothing (any repeat was absorbed). A person's manual send now retargets the card and moves the chat; bot repeats are still absorbed. e2e test added in `handoff.e2e.spec.ts` |

Environment notes: the API keeps at most 5 live sessions per user; scripts that log in repeatedly sign the browser out (not a product defect).
