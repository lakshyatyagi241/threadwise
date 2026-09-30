---
name: write-adr
description: >-
  Write a new Architecture Decision Record (ADR) for this repo in the correct
  MADR format, auto-numbered and linked from the docs index. Use this whenever
  making or asked to make a call that would be expensive to reverse — a new
  dependency, a schema pattern, an auth/security tradeoff, a "we're doing X
  instead of Y" decision — or whenever asked to "write an ADR", "document this
  decision", "record why we did X". Also use it when the user asks "why did
  we do X this way" and the honest answer is that no ADR exists yet — write
  one instead of answering from memory, so the reasoning survives past this
  conversation. Never hand-roll an ADR file by copying an old one's number or
  guessing the next available slot.
---

# Write an ADR

There are already 16 of these in `docs/adr/` — read two or three before
writing a new one (0002, 0006 and 0014 are good ones: a clear-cut technical
tradeoff, a security-adjacent rule, and a business-requirements-driven
decision). The tone and structure should be indistinguishable from the
existing set.

## 1. Is this actually ADR-worthy?

Yes, if reversing it later means real rework: a dependency choice, a schema
convention applied across many tables, an auth model, a compliance-gated
feature, "we chose A over B and B was seriously considered."

No — just fix it, or it's covered by an existing doc — for: a bug fix, a
naming nitpick, something already decided in
[docs/architecture/](../../../docs/architecture/) that doesn't need its own
record, a decision so easily reversed that writing it up costs more than
redoing it would.

If genuinely unsure, err toward writing it — a wrong-but-recorded 20-minute
decision is retrievable; an unrecorded one gets re-litigated from scratch six
months from now by someone who doesn't know it was already settled.

## 2. Create the file

```bash
bash .claude/skills/write-adr/scripts/new-adr.sh "short-kebab-case-title"
```

This finds the highest existing ADR number in `docs/adr/`, increments it,
stamps today's date, and copies the template
(`docs/adr/0000-template.md`) into the new file. Don't pick the number by
hand — a manual guess is exactly the kind of thing that produces a silent
collision if two people write an ADR the same week.

## 3. Fill in every section — especially the ones people skip

- **Context**: facts and constraints (scale, budget, deadline, compliance,
  team size), not opinions. If you can't cite a number or a concrete
  requirement, it's not context yet.
- **Decision**: one paragraph, active voice, present tense. What we're doing,
  not a survey of what we considered.
- **Consequences → Negative**: be honest. **Every real decision has a
  downside.** An ADR with no negative consequences hasn't been thought
  through, and readers of this repo's ADRs will notice and stop trusting
  them. Look at ADR-0002 or ADR-0011 for the right level of candor — they say
  outright where the choice is a real tradeoff, not just where it's obviously
  fine.
- **Alternatives considered**: the options that were genuinely on the table,
  with a _specific_ reason each lost — "too complex" is not a reason, "needs
  a second datastore and an on-call rotation we don't have" is.
- **Revisit when**: a concrete trigger condition. Without this, the decision
  calcifies into dogma nobody's allowed to question — see how ADR-0011 and
  ADR-0013 each name the exact signal that would reopen them.

## 4. Link it — then verify the link

Add a row to the table in
[docs/README.md](../../../docs/README.md#decision-records) — number, title,
status. If this ADR affects one of the architecture docs
(`docs/architecture/*.md`), add a cross-reference there too, the way
`multi-tenancy.md` links back to ADR-0002.

**Then invoke the `adr-diff-guard` skill** to confirm it actually landed in
the index and no reference is dangling. Forgetting the index row is the most
common mistake here, and it's silent — the ADR exists but nobody browsing
the docs will ever find it.

## 5. Status lifecycle

`proposed` → `accepted` once actually settled and acted on. If a later ADR
overturns this one, **don't delete it** — set its status to
`superseded by ADR-00NN`. The record of what was believed before matters as
much as the current answer; that's the whole point of keeping these instead
of just fixing the code and moving on.
