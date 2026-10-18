# DPDP Act 2023 and DPDP Rules 2025: gap analysis and compliance plan

Status: **proposal for owner review**, 15 Oct 2026. Nothing here is built or committed. Not legal advice: counsel questions are in section 9.

Read for this document:

- The Act: the Gazette text (Act 22 of 2023, 11 Aug 2023), sections 1 to 44 and the Schedule, in full.
  Source: [meity.gov.in PDF](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf).
- The Rules: G.S.R. 846(E), 13 Nov 2025, rules 1 to 23 and the First to Seventh Schedules, in full.
  Source: [meity.gov.in PDF](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf).
- The code: three read-only audit passes on 15 Oct 2026 (consent and notice; rights, retention, grievance; security, breach, processors,
  cross-border). The code is the evidence, not the docs. High-impact claims were re-checked by hand (audit retention floor, Redis
  password, Sentry host, breach code, terms acceptance). Deploy findings come from `deploy/hostinger` only; production may differ.
- The repo's own design: [privacy-and-data-governance.md](../specs/privacy-and-data-governance.md), [subprocessor-register.md](subprocessor-register.md),
  [breach-response-runbook.md](breach-response-runbook.md), [dsar-runbook.md](dsar-runbook.md).

## 1. Summary

**Verdict.** The foundations are strong: an append-only consent ledger, one fail-closed ConsentGate, a real erasure engine with proof,
forced RLS, guarded operator impersonation, an append-only audit log. The DPDP-specific layer on top is thin. The `dpdp_in` profile
stores settings and drives a checklist, and **nothing keyed to `dpdp_in` changes runtime behaviour**. Of the 47 obligations mapped in
section 3, 1 is followed, 26 are partial and 20 are not followed (row 44, the Significant Data Fiduciary duties, only bites if we or a
tenant class is notified).

**Where the money is.** The Act caps penalties per breach by provision (section 2.3). The three biggest tiers are the ones with the
largest gaps:

| Tier                       | Provision                 | Our state                                                                                                                                                                        |
| -------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| up to Rs 250 crore         | s8(5) security safeguards | Contact and message PII plaintext, no evidence of encryption at rest, Redis has no password, MFA off by default, off-site backup not configured, personal-data reads not audited |
| up to Rs 200 crore         | s8(6) breach intimation   | No breach register, no Board report, no principal notice, runbook is a skeleton with TODO owners                                                                                 |
| up to Rs 200 crore         | s9 children               | No age field, no parental consent, behavioural scoring and growth analytics run on everyone                                                                                      |
| up to Rs 50 crore (others) | s5, s6, s8(7), s11 to s14 | Notice not structured, no grievance system, no nominee, no purpose-end erasure, one-year log rule not met                                                                        |

**Timing.** The operative rules start about **13/14 May 2027** (18 months after publication); consent-manager registration (rule 4)
starts about **13/14 Nov 2026**, four weeks from now. MeitY floated shortening 18 months to 12 in Jan 2026; no notification found,
treat as a risk, not a fact (section 2.1).

**Capacity warning.** Everything in section 5 is about 110 person-weeks. The must-do core (P0 and P1) is about 80, or about 60 with the
MVP slices marked below. Three people at 60 percent on DPDP over the 30 weeks left is about 54. The plan only fits if scope is trimmed
or port work yields (section 6).

**Outside help.** No vendor, software or certification is required by law. Hire Indian data-protection counsel now and book a
penetration test for April (section 8). A Consent Manager is optional and not something to buy or build.

**What we ask.** Approve the decisions in section 7 (first: D-1 corporate seat and hosting, D-3 children, D-4 opt-in default). Then we
register the DP items in the backlog and start Phase 0.

## 2. The law on one page

### 2.1 Dates

| What                                                                                             | Date                           | Note                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rules 1, 2, 17 to 21 (short title, definitions, Board setup)                                     | 13/14 Nov 2025                 | In force on publication. Gazette is dated 13 Nov and was published 14 Nov: sources differ by a day.                                                                                                  |
| Rule 4 (consent manager registration and duties)                                                 | about 13/14 Nov 2026           | Rule 1(3): one year after publication.                                                                                                                                                               |
| Rules 3, 5 to 16, 22, 23 (notice, security, breach, retention, children, rights, SDF, transfers) | about 13/14 May 2027           | Rule 1(4): eighteen months after publication. The Act's operative sections follow the same date per secondary sources; the commencement notification itself was not read, **verify in the Gazette**. |
| Possible acceleration                                                                            | 12 months, i.e. about Nov 2026 | Proposed by MeitY in Jan 2026 (reported). No instrument found as of a 12 Oct 2026 review. Plan so P0 survives it.                                                                                    |

Secondary sources used for dates only: [SCC Online](https://www.scconline.com/blog/post/2025/12/26/digital-personal-data-protection-rules-2025-key-highlights/),
[Chambers on the 12-month proposal](https://chambers.com/articles/meity-plans-to-cut-short-dpdp-compliance-timeline-and-notify-cross-border-restrictions-for-sdfs),
[dpdprules.org](https://dpdprules.org/blog/dpdp-18-months-to-12-months-proposal).

### 2.2 Who is who (and what that means for us)

| Role in the Act                  | Who it is for us                                                                                                         | What the Act asks of it                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Data Fiduciary                   | The **tenant** for its contacts, leads, customers. **Threadwise** for tenant staff, billing, support, the marketing site | Everything in Chapter II and III. s8(1): responsible even for what a processor does, whatever the contract says.                    |
| Data Processor                   | **Threadwise** for the tenant's contact data                                                                             | Almost nothing directly. s8(2): only under a valid contract. s8(5): the fiduciary must secure data in processor hands too.          |
| Joint fiduciary (risk)           | Threadwise where it decides purpose or means itself: platform-key AI, growth enrichment, platform analytics              | Full fiduciary duties for that processing. Keep these paths off, or tenant-controlled.                                              |
| Significant Data Fiduciary (SDF) | Nobody notified yet. A WhatsApp CRM holding chats at scale could be assessed (s10(1): volume, sensitivity, risk)         | DPO based in India, independent auditor, yearly DPIA and audit, algorithm due diligence, possible data localisation (s10, rule 13). |
| Consent Manager                  | Not us. Third parties registered with the Board from about Nov 2026                                                      | We must be able to honour consent given or withdrawn through one (s6(7)).                                                           |

Practical effect: **tenants carry the legal duty, we carry the tooling, the contract and the security.** Tenants will ask us for proof of
all three (questionnaires, DPA, breach hours). For our own data (staff, billing, visitors) we carry the full Act.

Two reach points to settle in D-1: s3(b) applies the Act to processing outside India if it is connected to offering goods or services to
people in India; s17(1)(d) exempts an India-based processor handling data of people **outside** India under a contract with a foreign
party from Chapter II (except s8(1), s8(5)) and Chapter III. Which one applies to a workspace depends on where we sit and whom the
tenant serves.

### 2.3 Penalties (Schedule, s33)

| Breach                                          | Cap per breach         |
| ----------------------------------------------- | ---------------------- |
| s8(5) reasonable security safeguards            | Rs 250 crore           |
| s8(6) breach intimation to Board and principals | Rs 200 crore           |
| s9 children                                     | Rs 200 crore           |
| s10 SDF duties                                  | Rs 150 crore           |
| Any other provision of the Act or Rules         | Rs 50 crore            |
| s15 principal's duties (false complaint etc.)   | Rs 10,000              |
| Breach of a voluntary undertaking (s32)         | up to the original cap |

s33(2) lets the Board weigh gravity, repeat, gain, **mitigation and its timeliness**, and proportionality. Evidence of good faith
(drills, fixes, records) lowers exposure. s37: after two or more penalties the Government can order access to a service **blocked**.
Rule 19(9): the Board finishes an inquiry in six months, so evidence must be producible fast.

### 2.4 What the Act does not have (our docs sometimes assume it does)

- No "legitimate interest" or "contract" basis. Processing needs **consent (s6)** or one of the narrow **s7 uses** (voluntary provision
  for a specified purpose; legal duty; court order; medical emergency; employment; some State uses).
- No fixed 30-day answer time for access or erasure. Only the grievance system has a ceiling: **90 days** (rule 14(3)).
- No risk threshold for breaches: **every** personal data breach (s2(u)) goes to the Board and each affected person.
- No mandatory DPO except for an SDF. Everyone must still publish a contact who can answer (s8(9), rule 9).
- No fixed age ladder: a child is anyone under 18 (s2(f)).

## 3. Obligation map

Status: **FOLLOWING**, **PARTIAL**, **NOT FOLLOWING**, **N/A**. Owner: T tenant, P platform (us), B both. The "Build" column points to
section 5.

### A. Grounds, notice, consent (ss4 to 7, rule 3)

| #   | Requirement                                                                                                                                                                   | Owner      | Status        | Evidence and gap                                                                                                                                                                                                                                                                                                               | Build        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 1   | s4: process only on consent or an s7 use                                                                                                                                      | B          | PARTIAL       | Ledger and gate are solid. Registry uses GDPR bases (`packages/contracts/src/privacy/purposes.ts:44`); no per-contact s7 basis; default `requireConsentForMarketing:false` allows marketing without a grant                                                                                                                    | DP-32, DP-33 |
| 2   | s5(1), rule 3: notice before or with the consent request: standalone, plain, itemised data, purposes, what service, links to withdraw, exercise rights, complain to the Board | T (P tool) | PARTIAL       | `consent_notices` is versioned and immutable, but free text (1000 chars) plus two URLs. No fields for data items, purposes, rights link, withdrawal link or Board route. No hit for "Data Protection Board" in code. Consent is a tick-box line, not a standalone notice. Widget can collect name, email, phone with no notice | DP-30        |
| 3   | s5(2): notice to people who consented before commencement, "as soon as reasonably practicable"                                                                                | T (P tool) | NOT FOLLOWING | No re-notice send, no acknowledgement tracking. Existing contacts stay "No consent recorded" and are still messaged while the policy switch is off                                                                                                                                                                             | DP-36        |
| 4   | s5(3), s6(3): notice and consent request available in English or **any of the 22 Eighth Schedule languages**                                                                  | T (P tool) | PARTIAL       | Workspace default notice: English plus one of 12 codes. Widget, booking, store and form lines are one text, no locale, no visitor picker. 10 scheduled languages not offered (appendix A)                                                                                                                                      | DP-31        |
| 5   | s6(1): consent free, specific, informed, unconditional, unambiguous, clear affirmative act, limited to necessary data                                                         | T (P tool) | PARTIAL       | Unticked box, grant only when ticked, staff grants need a note. A form can be `required:true` and `marketing:true` together (`forms-builder/definition.ts:343`); one tick grants several channels; only two purposes (marketing, utility)                                                                                      | DP-34        |
| 6   | s6(3): contact of the DPO or authorised person in every consent request                                                                                                       | T (P tool) | NOT FOLLOWING | Officer contacts are stored per workspace but not embedded in notices, widget, forms, emails                                                                                                                                                                                                                                   | DP-30        |
| 7   | s6(4): withdraw at any time, as easily as consent was given                                                                                                                   | T (P tool) | PARTIAL       | STOP/START keywords, one-click email unsubscribe (RFC 8058) work. No withdraw control in widget, forms, booking, store. A `withdrawal` privacy request is closed by hand and writes no ledger event                                                                                                                            | DP-35        |
| 8   | s6(6): on withdrawal stop processing and make processors stop                                                                                                                 | B          | PARTIAL       | Marketing roll-up flag works and the dispatcher re-checks at send time. No cascade to AI, lead scoring, analytics or external processors                                                                                                                                                                                       | DP-34        |
| 9   | s6(10): fiduciary must prove notice and consent                                                                                                                               | T (P tool) | PARTIAL       | Strong: append-only trigger, idempotency key, source, actor, 300-char excerpt, sha256 of full text, notice version, proof export. Weak: no IP/UA by design, caller can backdate `occurredAt` (`consent.service.ts:220`), no hash chain, privileged session can delete                                                          | DP-37        |
| 10  | s7(a): voluntarily provided data may be used for the specified purpose unless she says no                                                                                     | T          | PARTIAL       | Policy matches (first inbound message permits replying only, never marketing). Not modelled: no stored s7 basis or specified purpose per contact. Checklist marks `lawful_basis` "built" on the registry alone                                                                                                                 | DP-32        |
| 11  | s6(7) to (9), rule 4: accept consent given or withdrawn through a Consent Manager                                                                                             | T (P tool) | NOT FOLLOWING | Name and URL placeholder only (`compliance/settings.ts:94`). No endpoint with CM identity, token, purpose list or withdrawal callback. Board standards for CMs not yet published                                                                                                                                               | DP-39        |
| 12  | Outbound sends gated at send time                                                                                                                                             | B          | PARTIAL       | One gate, 13 adopters, guard test. Open (allowlist): WhatsApp broadcasts gated at creation only; Telegram, Viber, WeChat broadcasts ungated; commerce sends honour the flag only. Quiet hours, calling window, DND stored but not enforced                                                                                     | DP-38        |

### B. Rights and grievance (ss11 to 15, rule 14)

| #   | Requirement                                                                                                                   | Owner      | Status        | Evidence and gap                                                                                                                                                                                                                                                                                                                                                               | Build        |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 13  | s11: summary of data and processing, **and identities of all fiduciaries and processors it was shared with**                  | T (P tool) | PARTIAL       | Machine-readable export ZIP works (`privacy/engine/export-builder.ts`). It lists no recipients. Workspace sub-processor list starts empty; the platform register exists only as a doc                                                                                                                                                                                          | DP-42        |
| 14  | s12(1), (2): correct, complete, update                                                                                        | T (P tool) | PARTIAL       | `rectification` is a request type; staff edits the contact by hand, then marks complete. Not linked to the edit, nothing propagated to recipients                                                                                                                                                                                                                              | DP-43        |
| 15  | s12(3), s8(7): erase on request unless needed for the purpose or by law                                                       | T (P tool) | PARTIAL       | Strong core: dry run, legal hold, transactional delete or anonymise, sha256 proof, 18 holders and about 95 tables enforced by a CI test. Misses `webhook_deliveries`, `event_outbox`, `message_event_archives`, `companies`, team chat, AI training and CRM-action tables, backups, Redis and queue payloads, vendor copies. A plain contact delete leaves leads, deals, tasks | DP-45        |
| 16  | s13, rule 14(3): effective grievance mechanism, published, answer within a period **not above 90 days**, exhaust before Board | B          | NOT FOLLOWING | Officer fields and a checklist item only. No grievance intake, ticket, SLA, escalation or record; no `grievance` request type (`contracts/src/privacy/requests.ts:10`)                                                                                                                                                                                                         | DP-41        |
| 17  | s14, rule 14(4): nominate someone to act on death or incapacity                                                               | T (P tool) | NOT FOLLOWING | No code references a nominee                                                                                                                                                                                                                                                                                                                                                   | DP-44        |
| 18  | rule 14(1), (2): publish how to make a request and which identifier is needed                                                 | B          | PARTIAL       | Only the opt-in `/trust/<slug>` page. No public request form (BL-147). Every endpoint of the rights engine is staff-only (`@ActorKinds('user')`)                                                                                                                                                                                                                               | DP-40        |
| 19  | s8(9), rule 9: publish a contact who can answer, and put it in **every response** to a rights request                         | B          | PARTIAL       | Configurable per workspace; shown only on `/trust` (DPO name and email, not the grievance officer). Not in export READMEs, notices or emails. Threadwise's own contact: template sentence only                                                                                                                                                                                 | DP-30, DP-40 |
| 20  | Identity check, rate limit, audit trail on rights requests                                                                    | B          | FOLLOWING     | Staff records verification method and evidence; gates export and erase; throttled; every action audited and evented. No automated channel OTP                                                                                                                                                                                                                                  | DP-40        |
| 21  | s8(3): accuracy and completeness where data drives a decision or is disclosed                                                 | B          | PARTIAL       | Dedupe on normalised phone and email; AI scores keep reasons; stage changes via suggestions. No quality gate before disclosure                                                                                                                                                                                                                                                 | DP-92        |
| 22  | Rights for Threadwise's own principals (staff, billing, visitors, support desk)                                               | P          | NOT FOLLOWING | Staff handler is an allowlisted follow-up; no handlers for the rest. Staff self-delete exists but leaves the email in audit and outbox payloads                                                                                                                                                                                                                                | DP-46        |

### C. Retention and erasure (s8(7), (8), rule 8)

| #   | Requirement                                                                                                                                                                                    | Owner      | Status        | Evidence and gap                                                                                                                                                                                                                                                                                                                                         | Build        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 23  | s8(7)(a): erase when consent is withdrawn or when the purpose is no longer served; make processors erase                                                                                       | B          | NOT FOLLOWING | No retention period per purpose; no auto-purge of contacts, messages, conversations (manifests say "Forever"). Per-log sweeps exist: raw leads 30d, call recordings 90d, message events 90d live and 365d total, FAQ and scoring logs 90d, flow and API logs 30d, notifications 90 or 180d                                                               | DP-50        |
| 24  | rule 8(1), (2) and Third Schedule: for **e-commerce (2 crore users), gaming (50 lakh), social media (2 crore)** fiduciaries, erase after 3 years of inactivity with **48 hours' prior notice** | T (P tool) | NOT FOLLOWING | Not modelled, no pre-erasure notice sender. Applies only to tenants in those classes at that size; offer as a tenant switch                                                                                                                                                                                                                              | DP-50        |
| 25  | rule 8(3): keep personal data, associated traffic data and logs of processing **for at least one year**, then erase                                                                            | B          | NOT FOLLOWING | Conflicts with current design. Audit log retention accepts 0 to 3650 days, default 365, **no floor** (`security-policy.ts:82`). Sessions purged at 90 days. Erasure and workspace erase delete history and logs at once (`lifecycle.repository.ts:338`). Spec defaults of 30 to 90 days for IP, webhook payloads, sessions (D5, 4.6) are below the floor | DP-14, DP-51 |
| 26  | Workspace inactivity lifecycle (ADR-0028)                                                                                                                                                      | P          | PARTIAL       | Designed with care (reminders, hold, log) but `ORG_LIFECYCLE_ENABLED=false`, dry run on, delete off; paid workspaces exempt; no export-on-exit though the DPA template promises 30 days; lapsed-plan wipe orphans files                                                                                                                                  | DP-52        |

### D. Security (s8(4), (5), rule 6)

| #   | Requirement                                                                          | Owner | Status        | Evidence and gap                                                                                                                                                                                                                                                                                                                                             | Build        |
| --- | ------------------------------------------------------------------------------------ | ----- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 27  | 6(1)(a): encryption, obfuscation, masking or tokens                                  | B     | PARTIAL       | Secrets: AES-256-GCM key ring, argon2 passwords, sha256 API keys. Contact `email`/`phone` and message `body` are plaintext columns. No at-rest config for Postgres, Redis; DB, Redis traffic is plain TCP on the compose network, Redis has no password (`REDIS_URL: redis://redis:6379`). Masking only in audit view, act-as and lead scoring | DP-10, DP-12 |
| 28  | 6(1)(b): control access to computer resources                                        | B     | PARTIAL       | Forced RLS, non-bypass role, RBAC, strong impersonation (super_admin, reason, 60 min, read-only, no exports). MFA **off by default**, super_admin included. `app.privileged` is a settable GUC (ADR-0028)                                                                                                                                                    | DP-11, DP-16 |
| 29  | 6(1)(c): visibility on access to personal data: logs, monitoring, review             | B     | PARTIAL       | Append-only audit with PII-safe rendering. Contact list and detail reads, conversation reads not audited (message streams exempt at `kernel/audit/audit.service.ts:28`). No push alerts or exfiltration detection; detection is a pull dashboard                                                                                                             | DP-13        |
| 30  | 6(1)(d): continued processing after loss: backups                                    | B     | PARTIAL       | Nightly verified pg_dump. Sealed off-site copy exists in code but is **not configured**; bucket media and exports not backed up; local dumps unencrypted; no PITR, no RTO/RPO; one restore test on dev data                                                                                                                                                   | DP-15        |
| 31  | 6(1)(e): keep logs and relevant data one year to detect and investigate              | B     | NOT FOLLOWING | See row 25. App stdout rotates at 20 MB x 5 with no shipping                                                                                                                                                                                                                                                                                                 | DP-14        |
| 32  | 6(1)(f), s8(2): security clause in the contract with every processor; valid contract | B     | PARTIAL       | DPA is a generated template with placeholders (`compliance/dpa.ts`). **No acceptance record anywhere.** Platform sub-processor register is a stale doc (it says no error tracking; Sentry is on by default to a US ingest host). DPA and region columns are TODO                                                                                             | DP-04, DP-91 |
| 33  | 6(1)(g), s8(4): technical and organisational measures that can be shown              | B     | PARTIAL       | `audit:tenancy`, `audit:authz`, `audit:auth`, `audit:sast`, gitleaks, Trivy, three HTML security reports. CI security workflows are manual (`workflow_dispatch`; Actions do not start on this account). No pen test, no vulnerability-disclosure channel                                                                                                     | DP-16, DP-90 |
| 34  | s8(5) generally: reasonable safeguards                                               | B     | PARTIAL       | Good: lockout, throttling, webhook HMAC, non-root container, headers, Sentry scrubbed. Gaps: upload malware scan is a no-op (`mail-attachment-scanner.ts`), Interakt webhook uses a `?k=` secret, 226 `sql.raw` uses unreviewed                                                                                                                              | DP-16        |
| 35  | AI paths that send contact text to third parties                                     | B     | PARTIAL       | Lead scoring is opt-in, masked, off by default. Widget, flow, campaign and FAQ AI send message text with a platform-key fallback and no workspace switch or notice. Translation may use an unofficial endpoint                                                                                                                                               | DP-74        |

### E. Breach (s8(6), rule 7)

| #   | Requirement                                                                                                                                                        | Owner | Status        | Evidence and gap                                                                          | Build        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------------- | ----------------------------------------------------------------------------------------- | ------------ |
| 36  | Tell **each affected principal** without delay: what happened, consequences, mitigation, what she can do, a contact (rule 7(1))                                    | B     | NOT FOLLOWING | No code. Runbook is a skeleton with TODO owners and "commonly cited" deadlines            | DP-20, DP-21 |
| 37  | Tell the **Board** without delay, then within **72 hours** the facts, causes, mitigation, findings on the cause, remedies, report on principal notices (rule 7(2)) | B     | NOT FOLLOWING | No register, no clocks, no report pack. "breach" appears in no contract, schema or module | DP-20, DP-22 |
| 38  | As processor: tell the tenant fast enough for it to meet 36 and 37                                                                                                 | P     | NOT FOLLOWING | DPA template has a placeholder "[48] hours"; no tenant-facing channel or template         | DP-21        |

### F. Children (s9, rules 10 to 12, Fourth Schedule)

| #   | Requirement                                                                                                                                          | Owner      | Status        | Evidence and gap                                                                                                                                                                   | Build        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 39  | s9(1), rules 10, 11: **verifiable parental or guardian consent** before processing a child's data, with due diligence that the adult is identifiable | T (P tool) | NOT FOLLOWING | Workspace flags `children_policy`, `parental_consent_required` only. No DOB or age field on contacts, widget or forms; no per-contact minor flag; no parent evidence (BL-180 open) | DP-60, DP-61 |
| 40  | s9(2), (3): no processing likely to harm a child; **no tracking, behavioural monitoring or targeted advertising of children**                        | B          | NOT FOLLOWING | `growth-pilot` and lead scoring run behavioural analysis on every contact. Gate reason `subject_minor` is designed, not wired                                                      | DP-62        |
| 41  | rule 12, Fourth Schedule: exemptions for clinics, education, creches, child transport, safety, email-only accounts                                   | T          | NOT FOLLOWING | Not modelled. Needed so legitimate education and health tenants are not blocked by DP-62                                                                                           | DP-62        |

### G. Transfers and processors (ss8(1), 8(2), 16, rules 13(4), 15)

| #   | Requirement                                                                                  | Owner | Status        | Evidence and gap                                                                                                                                                                                                                                                                                                | Build          |
| --- | -------------------------------------------------------------------------------------------- | ----- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 42  | s16, rule 15: transfers allowed unless the Government restricts a country or sets conditions | B     | NOT FOLLOWING | Hosting region undocumented (one Hostinger/Dokploy host). `data_residency` takes `any`/`eu_only`/`local` and only filters translation providers; no India mode. No per-vendor country tag, no way to cut off a country fast. Foreign recipients: Meta, Twilio, Google, Microsoft, Stripe, Sentry US, AI vendors | DP-70 to DP-73 |
| 43  | s8(1): responsibility for processors                                                         | P     | PARTIAL       | Row 32. Vendor list exists in docs; no executed DPAs recorded                                                                                                                                                                                                                                                   | DP-04, DP-91   |

### H. Significant Data Fiduciary (s10, rule 13)

| #   | Requirement                                                                                                                                                       | Owner | Status        | Evidence and gap                                                                                                             | Build |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----- |
| 44  | India-based DPO answerable to the board; independent data auditor; yearly DPIA and audit with report to the Board; algorithm due diligence; possible localisation | B     | NOT FOLLOWING | No DPIA tooling, audit store, platform DPO record, or algorithmic review of lead scoring. **Conditional: only if notified.** | DP-80 |

### I. Governance and enforcement (ss27 to 33, rule 19)

| #   | Requirement                                                                                  | Owner | Status        | Evidence and gap                                                                                                                              | Build        |
| --- | -------------------------------------------------------------------------------------------- | ----- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 45  | Producible evidence for a Board inquiry (six months): notice, consent, measures, logs        | B     | PARTIAL       | Pieces exist, no evidence pack                                                                                                                | DP-90        |
| 46  | Platform's own notices: privacy notice at signup, **terms acceptance record**, cookie choice | P     | NOT FOLLOWING | Signup validates `acceptTerms` but nothing persists version or time. Cookie choice is browser-only; with the banner off everything is allowed | DP-91        |
| 47  | Platform contact person and grievance route for Threadwise itself (s8(9), s8(10))            | P     | NOT FOLLOWING | A template sentence points at the contact page; no named person, no grievance intake                                                          | DP-03, DP-41 |

Count of the 47 rows: FOLLOWING 1 (row 20), PARTIAL 26, NOT FOLLOWING 20. Most partial rows mix a strong part and a gap (the consent
ledger, the gate, the erasure engine, RLS and impersonation are real strengths), so read the evidence column, not only the label.

N/A for a commercial platform: s7(b) to (h) (State, court, medical emergency, disaster uses) unless a tenant is a public body; s17 exemptions;
Chapters V to VII (Board procedure, appeal, mediation); rule 5 and the Second Schedule (State benefits); rules 16 to 23. s17(3) lets the
Government exempt classes of fiduciaries including startups from s5, s8(3), s8(7), s10, s11: **none notified**, do not plan on it.

## 4. Where our own docs and code say something the law does not

Fix these first: they make the checklist over-claim.

| #   | We say                                                                                                                         | The law says                                                                                                                         | Action |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1   | Purpose registry lawful bases `consent`, `contract`, `legitimate_interest`, `legal_obligation` (GDPR set), applied per purpose | Only consent or s7 uses. `analytics_profiling`, `ai_content_processing` etc. rest on "legitimate interest", which DPDP lacks         | DP-32  |
| 2   | `dpdp_in`: answer rights requests in 30 days "(inferred, not fixed)"                                                           | No fixed time for access or erasure; grievance ceiling is 90 days. Keep 30 as an internal target, label it so                        | DP-41  |
| 3   | `dpdp_in`: "grievance officer" required                                                                                        | Not a DPDP term. The Act wants a grievance **mechanism** (s8(10)) and a published **contact** (s8(9)); a DPO only for an SDF         | DP-41  |
| 4   | `dpdp_in`: "notice in English and one Indian language"                                                                         | The principal must be able to choose English **or any of the 22** Eighth Schedule languages (s5(3), s6(3))                           | DP-31  |
| 5   | Breach runbook: "as prescribed", CERT-In 6 hours as the India clock                                                            | Rule 7 is now concrete: Board without delay and detailed in 72 h; each principal without delay. CERT-In 6 h is a **separate** regime | DP-22  |
| 6   | Retention defaults: IP 30 d, webhook payloads 30 d, sessions 90 d, audit 13 months with floor 6 (spec 4.6, D5)                 | Rule 6(1)(e), 8(3): logs and relevant data at least one year                                                                         | DP-51  |
| 7   | Erasure proof note: "re-applied after any restore"                                                                             | No re-apply code or tombstone store exists (BL-153 planned only)                                                                     | DP-15  |
| 8   | Sub-processor register: "no error tracking found"                                                                              | Sentry is on by default to `ingest.us.sentry.io` in `deploy/hostinger/docker-compose.yml`                                            | DP-70  |
| 9   | Checklist marks `lawful_basis` "built"                                                                                         | Only the registry exists; no per-contact basis                                                                                       | DP-32  |
| 10  | `dpdp_in` profile switches consent behaviour                                                                                   | It does not; it only stores settings and reports. `consentHints` is annotated "nothing reads it yet"                                 | DP-33  |

## 5. What to build

Sizes use the repo scale: S days, M 1 to 2 weeks, L 3 to 5 weeks, XL longer. For capacity maths below: S 0.5, M 1.5, L 4, XL 8
person-weeks (rough). Priority: **P0** start now (high penalty tier, cheap blocker or first to bite), **P1** core Act duty before May 2027,
**P2** deferrable or conditional. IDs `DP-nn` are proposals; register them in the backlog after approval and cross-link the BL ids.

### Governance and decisions (no engineering)

| ID    | Item                                                                                                                                                                                             | Pri |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| DP-01 | Counsel pack: section 9 questions, DPA, notice wording, breach template review                                                                                                                   | P0  |
| DP-02 | Owner decisions D-1 to D-12 (section 7)                                                                                                                                                          | P0  |
| DP-03 | Name Threadwise's privacy contact, breach incident commander, grievance owner; publish the contact on site and app (rule 9)                                                                      | P0  |
| DP-04 | DPDP-aligned DPA: erasure cascade (s8(7)(b)), cease-processing (s6(6)), breach hours, sub-processor notice, India-law clauses                                                                    | P0  |
| DP-05 | One living DPDP register (this file) plus the change watch in section 10                                                                                                                         | P0  |
| DP-06 | Outside help (section 8): engage counsel in Phase 0, shortlist and book a penetration test firm by Feb 2027, decide the readiness review in Mar 2027, set up the off-site backup and log buckets | P0  |

### Security (rule 6, s8(5)): Rs 250 crore tier

| ID     | Item                                                                                                                                                                                                                           | Size | Pri | Note                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | --- | --------------------------------------------------------------------------------------------------- |
| DP-10  | Network and storage hardening: Redis password, private-network TLS for Postgres, Redis server-side encryption, written evidence of volume encryption and host region                                             | M    | P0  | Closes row 27 baseline                                                                              |
| DP-11  | Enforce MFA for super_admin, support, workspace owners and admins; default on for new workspaces                                                                                                                               | S    | P0  |                                                                                                     |
| DP-12a | Per-object encryption keys for recordings and files                                                                                                                                                                            | M    | P1  | Spec 4.7 item 2                                                                                     |
| DP-12b | Contact phone, email and message body column encryption with a blind index for search (decision D-9)                                                                                                                           | L    | P2  | Rule 6(1)(a) gives encryption, obfuscation, masking or tokens as examples; do DP-10 and DP-17 first |
| DP-13  | Personal-data read audit: contact view and export, bulk list sampling, conversation open, recording play, privacy exports; alerts on bulk reads, off-hours, new device. **MVP: audit reads + 3 alert rules (M)**               | L    | P0  | Row 29                                                                                              |
| DP-14  | One-year log floor: audit, auth, security and access logs minimum 365 days (contract min, not 0); ship app logs to retained storage; stop workspace erase and erasure deleting logs inside the year (design after counsel Q-1) | M    | P0  | Rows 25, 31                                                                                         |
| DP-15  | Backups: configure sealed off-site copy, back up the media bucket, encrypt local dumps, set RTO and RPO, scheduled restore drill, erasure re-apply tool (BL-153). **MVP: off-site + object storage + one drill (M-L)**                             | L    | P0  | Row 30; BL-153                                                                                      |
| DP-16  | Remaining s8(5): upload malware scan, Interakt signature check, finish privileged-GUC fix (ADR-0028), scheduled security CI (Actions do not start; run elsewhere), external penetration test                                   | M    | P1  | Rows 28, 33, 34                                                                                     |
| DP-17  | Role-based masking of phone and email for agents without the permission                                                                                                                                                        | M    | P2  | Row 27                                                                                              |

### Breach (rule 7, s8(6)): Rs 200 crore tier

| ID    | Item                                                                                                                                                                                             | Size | Pri |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | --- |
| DP-20 | Incident and breach register: awareness timestamp, severity, scope, status; clocks for "without delay" and 72 h; platform level and tenant level                                                 | L    | P0  |
| DP-21 | Affected-principal resolver (via the privacy registry) and notice composer with the five rule 7(1) elements; tenant notification path as processor; delivery through existing channels and email | L    | P0  |
| DP-22 | Board report pack (the six rule 7(2)(b) items) as PDF and JSON; rewrite the runbook to the Rules (keep CERT-In 6 h as a separate line); tabletop drills twice a year                             | M    | P0  |

### Notice and consent (ss5 to 7)

| ID    | Item                                                                                                                                                                                                                                                        | Size | Pri | Note              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- | ----------------- |
| DP-30 | Structured notice: itemised data, purposes, what service, rights link, withdrawal link, Board complaint route, contact person. Block enabling a notice without them. Render as a standalone page plus inline; fix the widget collecting data with no notice | L    | P1  | Rows 2, 6, 19     |
| DP-31 | 22-language notices and consent lines: per-notice translations, visitor language picker on widget, forms, booking, store; STOP keywords in more languages. **MVP: the 12 largest scheduled languages first, the rest on request (M-L)**                     | L    | P1  | Row 4             |
| DP-32 | DPDP lawful-use model: replace GDPR bases with `consent`, `s7(a) voluntary`, `legal obligation`, `employment`, `medical`; per-contact basis and specified purpose; fix checklist over-claim                                                                 | M    | P1  | Rows 1, 10        |
| DP-33 | Opt-in default for `dpdp_in` workspaces: tie `requireConsentForMarketing` to the profile with an explicit owner confirmation (D-4); migrate existing workspaces without silent send stops                                                                   | S    | P1  | Spec decision D13 |
| DP-34 | Per-purpose consent rows; call the gate for AI, profiling, sharing; withdrawal cascade to AI, scoring, analytics and processors; stop bundling required + marketing. **MVP: gate on AI and scoring, no processor API cascade (M)**                          | L    | P1  | Rows 5, 8         |
| DP-35 | Withdrawal parity: withdraw link in widget, forms, booking, store, preference page (BL-145); a completed `withdrawal` request writes the ledger                                                                                                             | M    | P1  | Row 7             |
| DP-36 | Legacy re-notice (s5(2)): bulk notice send to existing contacts with acknowledgement tracking. **MVP: send + count, no per-channel retries (M)**                                                                                                            | L    | P1  | Row 3             |
| DP-37 | Evidence hardening: keyed hash of IP and UA, full-text snapshot via notice version, refuse backdating beyond the import attestation window, hash chain                                                                                                      | M    | P2  | Row 9             |
| DP-38 | Close gate gaps: send-time re-check for WhatsApp broadcasts, gate Telegram, Viber, WeChat, commerce; enforce quiet hours by deferring, DND hook (BL-177). **MVP: gates only (M)**                                                                           | L    | P1  | Row 12            |
| DP-39 | Consent Manager adapter: authenticated inbound consent and withdrawal endpoint keyed to a registered CM. Wait for Board standards (BL-181)                                                                                                                  | M    | P2  | Row 11            |

### Rights and grievance (ss11 to 14, rule 14)

| ID    | Item                                                                                                                                                                                                                                                                         | Size | Pri |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- |
| DP-40 | Public request portal (BL-147): form per workspace, OTP verification through the contact's own channel, status page, automatic acknowledgement and final answer carrying the contact (rule 9). **MVP: form + OTP + email answer (M-L)**                                      | L    | P1  |
| DP-41 | Grievance system: `grievance` request type, intake, 90-day ceiling with a shorter internal target, escalation, record, "exhaust before the Board" text (s13(3)), published Board complaint route                                                                             | M    | P0  |
| DP-42 | Access export with recipients: seed a platform sub-processor register in the app; "shared with" per subject (s11(1)(b)); keep workspace list on top                                                                                                                          | M    | P1  |
| DP-43 | Correction workflow tied to the request: edit linked to the request, propagation to recipients                                                                                                                                                                               | S    | P1  |
| DP-44 | Nominee (s14): capture, store, use in request handling                                                                                                                                                                                                                       | S    | P1  |
| DP-45 | Erasure completeness: `webhook_deliveries`, `event_outbox`, `message_event_archives`, `companies`, team chat, AI training and CRM-action tables; extend the registry detector; Redis and queue TTL policy; vendor deletion log. **MVP: the five internal tables + TTLs (M)** | L    | P1  |
| DP-46 | Rights tooling for Threadwise as fiduciary: staff, billing, visitors, support desk handlers                                                                                                                                                                                  | L    | P1  |

### Retention (s8(7), (8), rule 8)

| ID    | Item                                                                                                                                                                                                                                                                                                                      | Size | Pri |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- |
| DP-50 | Retention engine (BL-146) on the DPDP model: purpose to period to trigger ("no approach for N"), last-approached tracking, workspace defaults, Third Schedule 3-year template and 48 h pre-erasure notice for qualifying tenant classes. **MVP: policy + last-approached + review queue, no auto-delete of messages (L)** | XL   | P1  |
| DP-51 | Rule 8(3) one-year floor, after counsel: processing-log tombstone kept a year after erasure; update spec 4.6 and D5 defaults                                                                                                                                                                                              | M    | P1  |
| DP-52 | ADR-0028 go-live: enable the lifecycle behind a dry run first, export-on-exit, fix lapsed-plan file orphaning                                                                                                                                                                                                             | M    | P2  |

### Children (s9, rules 10 to 12)

| ID    | Item                                                                                                                                                                                                                                            | Size | Pri |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- |
| DP-60 | Per-contact age band or DOB with source; age question on widget, forms, booking when the workspace says minors may be included; minor tag                                                                                                       | M    | P1  |
| DP-61 | Parental consent flow: hold the parent's reliable age and identity (rule 10) or a token from an authorised entity or DigiLocker; evidence record. Size depends on D-3 (tenant attestation plus evidence is the first step)                      | L    | P2  |
| DP-62 | Hard blocks for minors: no lead scoring, growth analytics, behavioural tracking, targeted ads, marketing broadcasts (gate reason `subject_minor`); Fourth Schedule exemption flags per workspace class (education, clinical, creche, transport) | M    | P1  |

### Cross-border, residency, AI (s16, rule 15, rule 13(4))

| ID    | Item                                                                                                                                                     | Size | Pri |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- |
| DP-70 | Facts first: host, region, DB, storage, backup, Sentry, every vendor's country; fill the register's DPA, region and transfer columns; fix the stale rows | S    | P0  |
| DP-71 | India residency mode: pin DB, storage, backups; India-only AI vendor allow-list (BL-152)                                                                 | XL   | P2  |
| DP-72 | Transfer-restriction readiness: country tag per vendor, kill switch to cut a notified country, tracker for rule 15 orders                                | M    | P2  |
| DP-73 | Sentry: confirm scrubbing, then move to an India or self-hosted project, or turn off by default until disclosed                                          | S    | P0  |
| DP-74 | AI switches and notices (BL-149): workspace switch per AI use, platform-key fallback only with tenant consent, translation lock-down                     | M    | P1  |

### SDF readiness (conditional) and evidence

| ID    | Item                                                                                                                                                                           | Size | Pri |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | --- |
| DP-80 | DPIA template and store, annual audit evidence, Board report export, India-based DPO record, algorithm review of lead scoring. **Start only if notified or a tenant class is** | L    | P2  |
| DP-90 | Evidence pack: s6(10) proof, s8(4) measures, policies, access reviews, DPA records, drill reports; one export for a Board inquiry                                              | M    | P1  |
| DP-91 | Platform fiduciary basics: terms and DPA acceptance records (version, time, hashed IP), server-side cookie choice, platform privacy notice and contact                         | M    | P1  |
| DP-92 | Privacy-by-design checklist gains DPDP questions (basis, notice, retention floor, children, recipients, accuracy); PR template line                                            | S    | P0  |

## 6. Phased plan

30 weeks from 15 Oct 2026 to 13 May 2027. P0 first so it also survives an early commencement.

| Phase | Dates                 | Goal                                 | Items                                                                                                                                          |
| ----- | --------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | 15 Oct to 13 Nov 2026 | Decide, fix facts, cheap safety wins | DP-01 to 06, DP-11, DP-70, DP-73, DP-92, first cut of DP-10 (Redis password), DP-14 floor change, consent-manager watch (rule 4 starts)        |
| 1     | 16 Nov to 31 Dec      | Security and breach spine, grievance | DP-10 rest, DP-13 (MVP), DP-15, DP-20 to 22, DP-41, DP-30 design, DP-32                                                                        |
| 2     | Jan to Feb 2027       | Tenant-facing duties                 | DP-30, DP-33, DP-34, DP-35, DP-38, DP-40, DP-42 to 44, DP-45 (MVP), DP-50 (MVP), DP-51, DP-60, DP-62, DP-12a, DP-16 start                      |
| 3     | Mar to Apr 2027       | Languages, legacy, platform duties   | DP-31, DP-36, DP-46, DP-74, DP-90, DP-91, DP-16 finish with external pen test (booked in Phase 2); tabletop breach drill; backup restore drill |
| 4     | 1 to 13 May 2027      | Freeze and prove                     | Evidence pack export, counsel sign-off on notices and DPA, go-live checks per workspace type, publish contacts                                 |
| After | from 14 May 2027      | Triggered or deferred                | DP-12b, 17, 37, 39, 52, 61, 71, 72, 80 as triggers fire (CM standards, SDF notice, country restriction, tenant demand)                         |

Capacity: P0 + P1 in full is about 80 person-weeks; with the MVP slices about 60. Three people at 60 percent on this for 30 weeks is about
54 person-weeks. Options, in order of preference: (1) take the MVP slices and accept P2 as post-May; (2) pause port work for two people
for Phases 1 and 2; (3) add one engineer or a contractor for DP-20 to 22 and DP-45. Do not cut P0.

Ownership split to discuss (not decided): one person owns security and breach (DP-10 to 16, 20 to 22, 70, 73), one owns consent, notice,
children (DP-30 to 38, 60 to 62), one owns rights, retention, platform duties (DP-40 to 52, 90 to 92).

## 7. Decisions needed from the owner

| #    | Decision                                                                                                                                                                | Recommendation                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| D-1  | Where does the company sit, and where is production hosted? Decides s3(b) reach, the s17(1)(d) exemption for foreign-only workspaces, and whether residency matters now | Answer first; it changes the scope of rows 42 and 44                                                             |
| D-2  | Role stance: processor for contact data, fiduciary for staff and billing, and keep platform-key AI and growth enrichment off unless the tenant switches them on         | Yes (spec D2) plus the AI rule                                                                                   |
| D-3  | Children: forbid in the terms and block (flag + DP-62), or support with parental consent (DP-61)?                                                                       | Forbid by default, allow a workspace to declare a Fourth Schedule class (education, clinical); build DP-61 later |
| D-4  | Default consent for workspaces in India: opt-in on                                                                                                                      | Yes, with a confirmation step and a dry-run count of contacts that would be held back                            |
| D-5  | Rule 8(3) one-year floor vs erasure                                                                                                                                     | Counsel first (Q-1); until then keep logs 365 days, never shorter                                                |
| D-6  | Residency: India region now or on demand                                                                                                                                | Document now (DP-70), build on demand, because DP-71 is XL                                                       |
| D-7  | Where do security CI jobs run, given Actions do not start on this account?                                                                                              | A scheduled runner or local gate; then a monthly report into DP-90                                               |
| D-8  | Budget: counsel, external penetration test, an independent DPDP gap review before May 2027                                                                              | Yes for counsel and the penetration test; the readiness review is optional. Reasons in section 8                 |
| D-9  | Contact PII column encryption with a blind index (spec D8)                                                                                                              | Defer; do DP-10 and DP-17 first and write the reasoning down                                                     |
| D-10 | Language scope for notices                                                                                                                                              | 12 largest scheduled languages for May 2027, the rest on request, stated in the notice                           |
| D-11 | Named privacy contact, incident commander, grievance owner for Threadwise                                                                                               | Name them in Phase 0 (DP-03)                                                                                     |
| D-12 | Capacity trade-off against the port (section 6)                                                                                                                         | MVP slices plus two people part-time off the port in Phases 1 and 2                                              |

## 8. Outside software and verification

**Short answer.** The law requires no particular software, no certification and no outside verifier for an ordinary fiduciary. The Act
sets outcomes ("reasonable security safeguards", s8(5); "appropriate technical and organisational measures", s8(4)). Rule 6 lists minimum
measures and names no tool. Neither the Act nor the Rules create a DPDP certification or an accreditation scheme for fiduciaries. The only
outsider the text requires is the independent data auditor of a Significant Data Fiduciary (s10(2)(b), rule 13), and nobody is notified.
Outside help is still worth paying for in three places, because the penalty caps are large (section 2.3) and the Board weighs mitigation
and how fast and how well a fiduciary responded (s33(2)(e)).

### 8.1 Consent Manager: do not buy, do not build, plan to accept

- **It is optional.** s6(7) says the principal "may" use one. Nothing makes a fiduciary onboard onto a Consent Manager or pay one.
- **Why we should not become one.** s2(g), s6(8), s6(9), rule 4 and the First Schedule make it a separate regulated business. Part A: a
  company incorporated in India, net worth of at least Rs 2 crore, and independent certification that its platform meets the Board's
  standards. Part B: acts in a fiduciary capacity, cannot read the data it routes, keeps consent records for at least seven years, cannot
  subcontract, must avoid conflicts of interest, and must be audited. That is a second company, not a feature.
- **Why we should not buy one.** There is nothing to buy. The principal chooses a Consent Manager, and the fiduciary receives consent
  and withdrawals from it. Registration opens about 13/14 Nov 2026 (rule 1(3)), and the Board has not yet published the standards that
  Part A item 9 refers to.
- **What we owe.** s6(7) and s6(6): a withdrawal made through a Consent Manager has the same effect as one made directly, and s13(1)
  extends the grievance duty to Consent Managers too. Our ledger already stops sends on a withdrawal event, but there is no
  authenticated entry point for a Consent Manager (row 11 of section 3).
- **When to build.** DP-39 stays P2. Trigger: the Board publishes the standards, or a registered Consent Manager exists and a tenant
  asks to receive consent through it. Until then, staff or the existing REST consent endpoint can record a Consent Manager message by
  hand with a note. Building an adapter now would mean guessing at an interface.

### 8.2 Software and services

| Need                                            | Required by law?                       | Why                                                                                                                                                                                                                                                              | Plan item    |
| ----------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Consent Manager platform                        | **No**                                 | s6(7) says "may". See 8.1                                                                                                                                                                                                                                        | DP-39        |
| A second consent or privacy-management suite    | **No, and not advised**                | The product already has the ledger, gate, rights engine and checklist. A second system splits the evidence s6(10) makes us produce, and each new vendor holding personal data needs its own contract (s8(2), rule 6(1)(f)) and appears in the s11 recipient list | none         |
| Off-site backup storage                         | **Needed in practice**                 | Rule 6(1)(d) asks for measures that keep processing going after loss, "such as data-backups". The sealed off-site copy exists in code but is not configured. Any S3-compatible bucket works                                                                      | DP-15        |
| Log storage with one-year retention             | **Needed in practice**                 | Rule 6(1)(c), (e) and rule 8(3). App logs rotate at 20 MB times 5 files today. A bucket plus log shipping is enough                                                                                                                                              | DP-14        |
| Alerting and on-call                            | **Needed in practice**, any product    | Rule 6(1)(c) asks for monitoring that detects unauthorised access. Rule 7 starts the breach clocks when we become aware, so someone must be reachable. Detection today is a dashboard people must open                                                           | DP-13, DP-22 |
| Malware scanning for uploads                    | **Advisable**                          | s8(5) reasonableness. The current scanner accepts everything. An open-source scanner such as ClamAV, or a hosted API, closes it                                                                                                                                  | DP-16        |
| Secrets store or key management service         | **Optional now**                       | Rule 6(1)(a) asks for encryption. The encryption key sits in the same `.env` as the database and backup credentials, so separating key from data is the measurable gain. Decide with D-9                                                                         | DP-12        |
| DigiLocker or other authorised-entity age token | **Only if we support children's data** | Rule 10(1)(b) and 10(2)(b), (c) accept a token from an authorised entity, including a DigiLocker provider, to check that a parent is an adult. Not needed if D-3 forbids children's data                                                                         | DP-61        |
| Cookie banner product                           | **No**                                 | The Act has no cookie rule. The gap is proof of the visitor's choice (s6(10)), which is a small build                                                                                                                                                            | DP-91        |
| Do-not-call registry feed                       | **Not a DPDP item**                    | Telecom rules for tenants who call or text Indian numbers. Separate law, tracked as BL-177 and BL-181                                                                                                                                                            | BL-177       |

### 8.3 People and firms

| Who                                        | Required by law?                                                                  | Why we recommend it                                                                                                                                                                                                                                                                                                     | When                                                                 | Plan item    |
| ------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------ |
| Indian data-protection counsel             | **No**, but treat it as essential                                                 | Section 9 lists ten questions the text does not answer, and several decide what we build: rule 8(3) against erasure (DP-14, DP-51), children (DP-60 to 62), the Board report format (DP-22), notice format (DP-30). Counsel also signs off the DPA (DP-04) and the notice wording. The Board has issued no guidance yet | Engage in Phase 0, before 13 Nov 2026                                | DP-01, DP-06 |
| External penetration test                  | **No**, but strongly advised                                                      | s8(5) carries the highest cap (Rs 250 crore). Rule 6(1)(g) and s8(4) ask for measures we can show. The repo has no penetration test record, and a report is the clearest proof of reasonable safeguards and mitigation (s33(2)(e)). Bank, insurer and health tenants often ask for one                                  | Book by Feb 2027, test in Apr after DP-10 to 16, retest in early May | DP-16, DP-06 |
| Independent DPDP readiness review          | **No**, optional                                                                  | Gives tenants and the Board a third-party view. It only pays off after the build, because before then it would list the gaps already in this plan                                                                                                                                                                       | Decide in Mar 2027 from tenant demand and budget                     | DP-90, DP-06 |
| Human reviewers for notice translations    | **No**, but s5(3) and s6(3) require the notice in the principal's chosen language | A machine draft of a legal notice in 12 or more languages can be wrong in ways that defeat the notice. Machine draft plus human check is cheap                                                                                                                                                                          | Phase 3, with DP-31                                                  | DP-31        |
| Independent data auditor and DPIA provider | **Only if notified as a Significant Data Fiduciary**                              | s10(2)(b), (c)(i), (ii) and rule 13(1), (2): yearly DPIA and audit, with a report to the Board. The text defines no qualification for the auditor. Nobody is notified                                                                                                                                                   | On notification                                                      | DP-80        |

Not needed, with the reason:

- **A Data Protection Officer.** Only a Significant Data Fiduciary must appoint one, and the officer must be based in India (s10(2)(a)).
  Everyone else must still publish a contact who can answer questions (s8(9), rule 9), which is DP-03.
- **A "grievance officer" as a named post.** The Act requires an effective grievance mechanism (s8(10), s13), not an officer.
- **ISO 27001 or SOC 2.** Neither the Act nor the Rules ask for them. They help in enterprise sales, cost months, and the repo claims
  neither (privacy spec 8.3). Defer until a tenant requires it.
- **A "DPDP certificate".** None exists in the Act or Rules for fiduciaries. Be wary of anyone selling one.

### 8.4 Order of spend

1. **Counsel first.** Nothing else in this plan gets cheaper if the answers to Q-1, Q-4, Q-5 and Q-6 arrive after the code is written.
2. **Penetration test second.** It covers the largest penalty tier. Run it after the security fixes land, so the money pays to find new
   problems and not known ones. Scope: web app, API, tenant isolation (cross-tenant access under RLS), operator impersonation, webhook
   endpoints, the mobile app and the host. Include one retest in the price. Do not give testers production data.
3. **Translators in Phase 3,** for the languages chosen under D-10.
4. **Readiness review last, and only if budget remains.** It is evidence, not a fix.
5. **Data auditor and DPIA provider only on notification.**

When shopping: for counsel, ask for DPDP and SaaS-processor experience and a fixed fee for the section 9 questions plus the DPA. For the
penetration test, ask whether the firm is empanelled with CERT-In (regulated Indian buyers often expect it; confirm with counsel and your
largest tenants), whether the report can be shared with tenants under NDA, and whether a retest is included.

### 8.5 What this section did not check

- Costs. None of these were priced; get quotes before D-8 is decided.
- Whether the Board has defined auditor qualifications or published Consent Manager standards since 14 Nov 2025.
- Whether a given tenant contract already demands a certification we do not hold.
- Vendor capabilities. The software rows say what the law needs, not which product to choose.

## 9. Questions for counsel

1. Rule 8(3) says keep "such personal data, associated traffic data and other logs" for a year after processing. How does that sit with an
   erasure request (s12(3)) and with consent withdrawal (s8(7)(a))? What exactly must be kept: all data, or logs and traffic data?
2. Is a processor exposed directly under the Act, or only through the tenant's contract? What if we are a joint fiduciary for AI scoring?
3. Is a business-initiated WhatsApp message after a lead's first message ever within s7(a), and how narrow is the "specified purpose"?
4. What does a standalone notice look like on WhatsApp, an in-chat widget, and a short form?
5. For a B2B CRM, which of our features amount to "tracking or behavioural monitoring" of a child, and how is a tenant's age knowledge handled?
6. Board reporting: what channel and format for the rule 7(2) reports, and does a processor report or only the fiduciary?
7. Interaction of the DPDP breach rule with CERT-In's 6-hour rule and any sector rules for our tenants (banks, insurers, health).
8. Third Schedule: do tenants in e-commerce, gaming, social media at the stated sizes need a 48 hour notice tool from us?
9. Does an India-hosted copy plus foreign AI vendors need disclosure or consent today (s16 is a negative list; none notified)?
10. The Consent Manager standards: when do they publish, and what must a fiduciary build to accept consent through one?

## 10. Not covered, assumptions, change watch

- **Not verified:** production configuration (`deploy/hostinger` is the only deploy evidence); anything not reachable by search of the code;
  whether the app runs these paths as described (nothing was run); the commencement notification for the Act's operative sections; sector
  rules (RBI, IRDAI, health) that tenants may also face.
- **Assumed:** Threadwise is a processor for tenant contacts and a fiduciary for its own data (spec D2). Hosting is the single
  Hostinger host.
- **Change watch (review quarterly and on any notice):** any amendment of rule 1 timing; Board standards for Consent Managers; SDF
  notifications; s16 country restrictions and rule 15 orders; the s17(3) exemptions for startups; Board guidance on notice format and
  breach portal.

## Appendix A. The 22 Eighth Schedule languages

Assamese, Bengali, Bodo, Dogri, Gujarati, Hindi, Kannada, Kashmiri, Konkani, Maithili, Malayalam, Manipuri, Marathi, Nepali, Odia,
Punjabi, Sanskrit, Santali, Sindhi, Tamil, Telugu, Urdu. The workspace notice offers 12 codes today (`INDIAN_NOTICE_LOCALES`); the app UI
has 21 locales of which only Hindi, Bengali and Urdu are scheduled languages. Not offered: Bodo, Dogri, Kashmiri, Konkani, Maithili,
Manipuri, Nepali, Sanskrit, Santali, Sindhi.

## Appendix B. Map to existing backlog

| Existing | DP items                                                        |
| -------- | --------------------------------------------------------------- |
| BL-140b  | DP-32, DP-34 (storage columns for purpose, basis, subject type) |
| BL-141   | DP-38                                                           |
| BL-145   | DP-35                                                           |
| BL-146   | DP-50                                                           |
| BL-147   | DP-40, DP-91                                                    |
| BL-149   | DP-74                                                           |
| BL-150   | DP-13 (PII annotation helps log redaction and read audit)       |
| BL-151   | DP-16, DP-22                                                    |
| BL-152   | DP-71                                                           |
| BL-153   | DP-15, DP-12                                                    |
| BL-177   | DP-38                                                           |
| BL-180   | DP-60, DP-62                                                    |
| BL-181   | DP-39, DP-20 to 22                                              |
