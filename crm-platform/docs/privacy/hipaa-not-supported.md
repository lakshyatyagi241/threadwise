# HIPAA: not supported, and what would be needed

Part of [privacy-and-data-governance.md](../specs/privacy-and-data-governance.md) section 11.7. Not legal advice: counsel confirms every
sentence before it goes into the terms.

## Position

- **We do not claim HIPAA compliance.** The product is not designed, assessed or operated as a HIPAA business associate.
- **We do not sign a Business Associate Agreement (BAA)** with any workspace, and no vendor in the
  [sub-processor register](subprocessor-register.md) is assumed to have signed one with us.
- **Workspaces must not store protected health information (PHI)** in the product: not in contacts, notes, messages, files, call
  recordings, forms, appointments or custom attributes. PHI is health information that identifies a person and is held by a health plan,
  a healthcare provider or their business associates in the United States.
- Booking a haircut or collecting a name and phone number is not PHI. A clinic that stores diagnoses, treatment notes, prescriptions,
  insurance numbers or test results in the CRM would be.
- SOC 2 and ISO 27001 are out of scope as well (privacy spec section 8.3). Payment card numbers are handled by the payment gateways, not
  stored here.

## Where the notice is shown

1. **Onboarding**, workspace step: one sentence under the workspace details ("Do not store protected health information...").
2. **Settings, Security, Compliance center**: a card with the same sentence and the link to this position.
3. **The platform terms** (the owner's document). Suggested clause, a draft for counsel:

   > The service is not designed for, and Customer must not submit or store, protected health information as defined by the US Health
   > Insurance Portability and Accountability Act (HIPAA) or similar health-data rules. Provider does not enter into business associate
   > agreements and is not responsible for health information Customer submits in breach of this clause.

## What would be needed to support HIPAA

This is a list for a future decision (owner decision D17 and a business case), not a plan.

| Area                         | What HIPAA-ready would mean here                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BAA                          | A signed BAA with each customer (we are the business associate), and a BAA with every sub-processor that may touch PHI (hosting, storage, email, SMS, WhatsApp, AI, speech). Several of today's vendors do not offer one. |
| Access                       | Unique user identity, role-based access with minimum necessary, automatic logoff, emergency access, access review. Operator act-as ([ADR-0020](../adr/0020-operator-impersonation-act-as-token.md)) would need per-event customer approval or a break-glass record. |
| Audit                        | Tamper-evident audit of every read and write of PHI (today the audit log records changes; reads are logged for recordings and exports only), retained for the HIPAA period (six years for policies and documentation). |
| Encryption                   | Encryption in transit everywhere and at rest for PHI fields, files and backups with customer-scoped keys; message bodies are plaintext at rest today (privacy spec G7, BL-153).            |
| Integrity and availability   | Backup, restore and disaster recovery tests with documented results; backups that can be scrubbed on erasure (G6).                                                                       |
| Breach notification          | A breach process that meets the HIPAA clock (60 days to affected individuals and HHS; business associate to covered entity without unreasonable delay), not the GDPR one in the runbook.   |
| Risk analysis                | A written security risk analysis and management plan, workforce training and sanctions, a security official.                                                                              |
| Product limits               | A PHI-safe mode that disables AI vendors, translation vendors, push previews, webhooks and exports that send content to third parties, and blocks channels without a BAA path (for example personal WhatsApp). |
| Contracts and documentation  | Policies and procedures, retention of documentation, a process for individual access requests that matches 45 CFR 164.524 timelines (30 days).                                           |

Until the owner decides otherwise, the answer to a customer who asks for a BAA is: not supported.
