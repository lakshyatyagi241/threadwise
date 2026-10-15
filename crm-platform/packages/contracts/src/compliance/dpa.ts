import type { ComplianceRegime } from './regimes';

/**
 * The data processing agreement TEMPLATE the Compliance center downloads (BL-173). Plain Markdown text with the workspace's own details
 * filled in. A template for the workspace and its counsel: it is not legal advice, not a signed agreement, and it carries no claim of
 * certification. Structure mirrors docs/privacy/dpa-template.md.
 */
export interface DpaTemplateInput {
  workspaceName: string;
  officer: { name: string; email: string };
  privacyUrl: string | null;
  termsUrl: string | null;
  regimes: readonly ComplianceRegime[];
  subprocessors: ReadonlyArray<{
    name: string;
    purpose: string;
    location: string;
    dpaUrl: string | null;
  }>;
}

const or = (v: string | null | undefined, fallback: string): string =>
  v && v.trim() !== '' ? v.trim() : fallback;

export function buildDpaTemplate(input: DpaTemplateInput): string {
  const subs =
    input.subprocessors.length === 0
      ? '- [No sub-processors are listed yet. List every vendor that handles personal data for this workspace.]'
      : input.subprocessors
          .map(
            (s) =>
              `- ${s.name}: ${or(s.purpose, '[purpose]')}; location ${or(s.location, '[location]')}; DPA ${or(s.dpaUrl, '[link]')}`,
          )
          .join('\n');
  const officer = [input.officer.name, input.officer.email]
    .filter((v) => v.trim() !== '')
    .join(', ');
  return `# Data processing agreement (template)

This is a template to help you prepare an agreement. It is not legal advice and it is not a signed agreement. Have your counsel review every
clause, the roles, the transfer mechanism and the notice periods. Text in [brackets] is for the parties to complete.

## 1. Parties and roles

- Customer (controller; under the DPDP Act, data fiduciary): ${or(input.workspaceName, '[legal name, address]')}.
- Provider (processor): [legal name, address of the platform operator].
- Privacy contact of the Customer: ${or(officer, '[name, email]')}.
${input.privacyUrl ? `- Customer privacy policy: ${input.privacyUrl}\n` : ''}${input.termsUrl ? `- Customer terms: ${input.termsUrl}\n` : ''}
## 2. Subject matter and purpose

The Provider processes personal data on the Customer's behalf to provide the messaging and customer-relationship service, for the term of the
agreement and until deletion under clause 9. Data subjects: the Customer's contacts, leads, end customers and staff. Data: identifiers and
contact details, messages and files, call recordings where the Customer switched them on, consent records, form answers, appointment and order
details. Protected health information and other special categories must not be submitted.

## 3. Instructions

The Provider processes personal data only on the Customer's documented instructions (this agreement and the settings the Customer chooses in the
product) unless law requires otherwise, and tells the Customer if an instruction appears to break data protection law.

## 4. Confidentiality and security

People authorised to process the data are bound by confidentiality. The Provider applies the measures in Annex II (tenant isolation, encryption of
stored credentials and of data in transit, access control, audit logging, backups, a breach response process).

## 5. Sub-processors

The Customer authorises the sub-processors in Annex III. The Provider informs the Customer [30] days before adding or replacing one, and the
Customer may object on reasonable grounds. The Provider binds each sub-processor to the same obligations and stays responsible for it.

## 6. International transfers

Where personal data leaves the Customer's country or region, the parties rely on [adequacy decision / standard contractual clauses / other
mechanism, to be chosen with counsel]. Annex III states each sub-processor's location.

## 7. Help with requests from people

The Provider helps the Customer answer requests for access, export, rectification, erasure, restriction, objection and portability with the tools
in the product and reasonable further assistance, and passes on a request it receives directly.

## 8. Personal data breach

The Provider notifies the Customer without undue delay, and within [48] hours of becoming aware, of a breach affecting the Customer's data, so the
Customer can meet its own deadlines.

## 9. Return and deletion

On termination the data stays available for export for [30] days and is then deleted, except where law requires retention. Backups age out on the
documented schedule and erasures are re-applied after a restore.

## 10. Audits

The Provider supplies the information needed to show compliance with this agreement and allows audits on [reasonable notice, once a year]. The
Provider does not claim SOC 2, ISO 27001 or HIPAA certification.

## 11. Liability and governing law

[To be completed by counsel.]

## Annex I: regimes the Customer switched on

${input.regimes.length > 0 ? input.regimes.map((r) => `- ${r}`).join('\n') : '- None chosen yet.'}

## Annex II: technical and organisational measures

[Describe the measures. See the Provider's security documentation.]

## Annex III: sub-processors

${subs}
`;
}
