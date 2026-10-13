# Personal data breach response runbook (skeleton)

Skeleton for the owner and counsel to complete. Design context: [privacy-and-data-governance.md](../specs/privacy-and-data-governance.md)
section 4.7. The notification deadlines below are stated as the commonly cited ones and **need counsel confirmation** before use.
Owner names, phone numbers and templates are TODO.

## Roles (TODO names)

- Incident lead (decides severity, owns the timeline): TODO
- Technical lead (contain, investigate): TODO
- Privacy / legal contact (regulator and tenant communications): TODO
- Communications (customer notices): TODO

## 1. Detect and triage (first hour)

Signals: alerts from observability (`apps/api/src/modules/platform-infrastructure/observability`), a tenant report, a vendor notice, a
security researcher report, unusual operator act-as sessions ([ADR-0020](../adr/0020-operator-impersonation-act-as-token.md)), a leaked
key. Record time of discovery (the clocks start from awareness).

Classify: confidentiality (data seen/taken), integrity (changed), availability (lost). Which tenants? Which data classes from the
[inventory](../specs/privacy-and-data-governance.md#2-data-inventory)? Encrypted at rest or plaintext (message content is plaintext,
secrets are AES-GCM)?

## 2. Contain

Revoke or rotate keys ([key-rotation.md](../runbooks/key-rotation.md)), disable the affected integration or account, block the vector,
preserve logs and snapshots. Suspend a tenant if needed (ADR-0019). Do not delete evidence.

## 3. Assess risk

Number of people, kind of data, ease of identifying, likely harm, whether data was unintelligible to the finder. Document the decision
to notify or not, with reasons, even when not notifying.

## 4. Notify (deadlines to be confirmed by counsel)

| Who                                                   | When (commonly cited)                                                                         | Notes                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Tenants (we act as processor)                         | without undue delay; contract will set hours (TODO in the DPA)                                | they are the controllers for contact data and decide on regulator and individual notices |
| EU/UK supervisory authority                           | 72 hours from awareness, where the controller is subject to GDPR and the risk is not unlikely | by the controller; as a controller for staff and billing data, by us                     |
| India CERT-In                                         | 6 hours for listed cyber incident types                                                       | counsel to confirm scope for our services                                                |
| India DPDP Data Protection Board and affected persons | as prescribed under the DPDP rules                                                            | counsel to confirm                                                                       |
| UAE / KSA authorities                                 | per local law                                                                                 | counsel                                                                                  |
| US states                                             | per state breach laws                                                                         | counsel                                                                                  |
| Individuals                                           | when high risk                                                                                | wording from counsel                                                                     |
| Vendors                                               | per DPA                                                                                       |                                                                                          |

## 5. Eradicate and recover

Patch, rotate, restore from backup (remember to re-apply erasures after restore: [dsar-runbook.md](dsar-runbook.md)), monitor.

## 6. Learn

Blameless review within two weeks, update the inventory, the checklist and monitoring; track actions in the backlog.

## 7. Evidence kept

Timeline, decisions, notices sent, data categories and counts, containment steps. Retain per counsel advice (TODO).
