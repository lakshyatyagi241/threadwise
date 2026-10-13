import { Injectable } from '@nestjs/common';

/**
 * ANTIVIRUS HOOK POINT (TW-MAIL-027). Every composer upload passes through `scan` BEFORE it is stored. The default accepts everything:
 * the upload policy of the object store (extension and content signature) already refuses executables and scripts, and a platform that
 * needs malware scanning replaces this class body (or provides a subclass in `module-parts.ts`) with a call to its scanner (ClamAV over
 * `clamd`, a SaaS API). A scanner that is down should throw: the upload then fails retryable instead of letting an unscanned file through.
 */
@Injectable()
export class MailAttachmentScanner {
  scan(_file: {
    orgId: number;
    name: string;
    mime: string;
    bytes: Buffer;
  }): Promise<{ clean: true } | { clean: false; reason: string }> {
    return Promise.resolve({ clean: true });
  }
}
