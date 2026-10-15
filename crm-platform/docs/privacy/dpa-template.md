# Data processing agreement: template

Part of [privacy-and-data-governance.md](../specs/privacy-and-data-governance.md) section 11 (baseline point B7). **This is a template
for the owner and counsel, not legal advice and not a signed agreement.** Brackets are for the parties to complete. Counsel must review
every clause, the roles (decision D2), the transfer mechanism and the sub-processor notice period before anyone relies on it.

The Compliance center (Settings, Security) downloads the same structure with the workspace's own details filled in (name, officer
contact, sub-processor list, privacy and terms links). The text is built by `buildDpaTemplate` in `packages/contracts/src/compliance`.

## 1. Parties and roles

- **Customer** (the workspace owner): [legal name, address]. Acts as controller (under the DPDP Act, data fiduciary) of the personal data
  of its contacts, leads and end customers.
- **Provider** (the platform operator): [legal name, address]. Acts as processor (data processor) of that data. For staff accounts,
  billing and security of the service the Provider is a controller in its own right.
- Contact for privacy matters: Customer [name, email]; Provider [name, email].

## 2. Subject matter, duration, nature and purpose

Provider processes personal data on Customer's behalf to provide the messaging and customer-relationship service, for the term of the
agreement and until deletion under clause 9. Categories of data subjects: Customer's contacts, leads, end customers and staff. Categories
of personal data: identifiers and contact details, messages and files exchanged, call recordings where Customer switched them on,
consent records, form answers, appointment and order details. Special categories and protected health information must not be
submitted (see [hipaa-not-supported.md](hipaa-not-supported.md)).

## 3. Instructions

Provider processes personal data only on Customer's documented instructions (this agreement, the settings Customer chooses in the
product, and Customer's use of its features), unless law requires otherwise, in which case Provider informs Customer first where allowed.
Provider tells Customer if it believes an instruction breaks data protection law.

## 4. Confidentiality and security

Persons authorised to process the data are bound by confidentiality. Provider applies the measures in [Annex II]: tenant isolation by
row-level security, encryption of stored credentials, encryption in transit, access control and audit logging, backups, a breach
response process ([breach-response-runbook.md](breach-response-runbook.md)).

## 5. Sub-processors

Customer gives general authorisation for the sub-processors listed in [Annex III] (the Provider's register,
[subprocessor-register.md](subprocessor-register.md), and the Customer's own list in the Compliance center). Provider informs Customer
[30] days before adding or replacing one; Customer may object on reasonable grounds. Provider imposes the same obligations on
sub-processors in writing and remains responsible for them.

## 6. International transfers

Where personal data leaves the country or region of the Customer, the parties rely on [adequacy decision / standard contractual
clauses / other mechanism: to be chosen with counsel]. The hosting region of each sub-processor is in Annex III.

## 7. Assistance with data-subject rights

Provider helps Customer answer requests for access, export, rectification, erasure, restriction, objection and portability with the tools
in the product (Settings, Data requests) and reasonable further assistance. A request that reaches Provider directly is passed to
Customer without undue delay.

## 8. Personal data breach

Provider notifies Customer without undue delay and in any case within [48] hours of becoming aware of a breach affecting Customer's
data, with the information in the runbook, so Customer can meet its own deadlines (72 hours under the GDPR, the DPDP Rules, 6 hours to
CERT-In for listed incidents, other regimes as they apply).

## 9. Return and deletion

On termination Provider makes the data available for export for [30] days and then deletes it, including copies, except where law requires
retention (for example financial records). Backups age out on the schedule in the runbooks and erasures are re-applied after a restore.

## 10. Audits

Provider provides the information needed to show compliance with this agreement and allows audits by Customer or its auditor on
[reasonable notice, once a year, at Customer's cost]. Provider does **not** claim SOC 2, ISO 27001 or HIPAA certification.

## 11. Liability and governing law

[To be completed by counsel.]

## Annexes

- **Annex I**: details of processing (clause 2) and the list of the Customer's regimes (the profiles switched on in the Compliance
  center, which the document prints for information).
- **Annex II**: technical and organisational measures.
- **Annex III**: sub-processors, with purpose, data, location and DPA link (printed from the list).
