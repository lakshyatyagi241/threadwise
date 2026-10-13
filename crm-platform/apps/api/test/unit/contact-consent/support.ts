import {
  consentExportJobId,
  consentExportJobSchema,
} from '../../../src/modules/contact-consent/consent-export.job';

/** The job id has no colon (BullMQ reserves it) and the payload schema accepts ids only. */
export function consentJobIdOk(exportUuid: string): boolean {
  return (
    !consentExportJobId(exportUuid).includes(':') &&
    consentExportJobSchema.safeParse({ orgId: 1, exportUuid }).success &&
    !consentExportJobSchema.safeParse({ orgId: 1, exportUuid: 'nope' }).success
  );
}
