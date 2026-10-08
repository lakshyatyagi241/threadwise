'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import {
  REPORT_DOCUMENT_EXTENSIONS,
  REPORT_DOCUMENT_LIMITS,
  type ReportDocumentListResponse,
  type ReportScope,
} from '@crm/contracts';
import { reportDocumentsKey, useUploadReportDocument } from '../api/hooks';
import { runUploads, upsertAttempt, type Attempt } from '../lib/upload-queue';

/**
 * Adding files to the library from anywhere on the page (the Documents panel, the chat's "+" menu). It uses the one upload hook, so
 * the list and the count the assistant is told about refresh after each file. Does nothing without permission to manage.
 */
export function useDocumentUploader(scope: ReportScope, canManage: boolean) {
  const qc = useQueryClient();
  const upload = useUploadReportDocument(scope);
  const [attempts, setAttempts] = useState<Attempt[]>([]);

  const add = useCallback(
    async (files: readonly File[]): Promise<number> => {
      if (!canManage || files.length === 0) return 0;
      const list = qc.getQueryData<ReportDocumentListResponse>(reportDocumentsKey(scope));
      return runUploads({
        files,
        existing: list?.data.length ?? 0,
        max: list?.limit ?? REPORT_DOCUMENT_LIMITS.maxDocuments,
        extensions: REPORT_DOCUMENT_EXTENSIONS,
        maxBytes: REPORT_DOCUMENT_LIMITS.fileBytes,
        upload: (f) => upload.mutateAsync(f),
        onChange: (a) => setAttempts((prev) => upsertAttempt(prev, a)),
      });
    },
    [canManage, qc, scope, upload],
  );

  const dismiss = useCallback(
    (key: string) => setAttempts((prev) => prev.filter((a) => a.key !== key)),
    [],
  );
  const clearFinished = useCallback(
    () => setAttempts((prev) => prev.filter((a) => a.status === 'busy')),
    [],
  );

  return { attempts, add, dismiss, clearFinished };
}
