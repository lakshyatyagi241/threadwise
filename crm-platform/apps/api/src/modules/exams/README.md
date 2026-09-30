# Exam Applications

Not implemented yet. Structure to follow when it lands:

```
exams/
  exams/            offerings per cycle
  forms/            multi-step form builder + schema
  candidates/       portal identity (NOT staff users)
  applications/     submit, review, verify
  documents/        upload + verification workflow
  slots/            centres, capacity, booking
  admit-cards/      PDF issuance
  counselling/      rounds + seat allocation
  exams.module.ts
  index.ts
```

## Key decisions

- **Candidates are a separate identity pool.** Not staff `users`, not
  `partner_agents`. Each candidate is linked to a `contact` so the institute
  sees applications and WhatsApp chats on one timeline.
- **Slot booking is an atomic increment**, not read-then-write:
  `UPDATE exam_slots SET booked_count = booked_count + 1 WHERE id = ? AND booked_count < capacity`
  Zero rows affected = the slot filled while the candidate was deciding.
- **Form definitions live in `form_schema` JSONB** using the kernel's field-type
  vocabulary, so a new form is configuration rather than a deployment.
- **Status changes flow through the outbox**, which is how "payment pending" and
  "documents rejected" nudges reach the candidate over WhatsApp through the same
  broadcast machinery the CRM uses.
