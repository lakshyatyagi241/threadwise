'use client';

import {
  IMPORT_SAMPLE_HEADERS,
  IMPORT_SAMPLE_ROWS,
  type ContactImportOptions,
  type ImportField,
} from '@crm/contracts';
import { toApiError } from '@/lib/api/errors';
import { apiFetch } from '@/lib/api/client';
import {
  contactImportJobSchema,
  contactImportPreviewSchema,
  type ContactImportJob,
  type ContactImportPreview,
} from './schemas';

/**
 * CSV import (`/v2/contacts/import`): preview what a file would do, start the import, follow a queued one, download
 * the rejected rows. Files go up as multipart (`file` plus an `options` JSON string), so these calls do not use the
 * JSON client.
 */

export type ImportOptions = Pick<
  ContactImportOptions,
  'mapping' | 'status' | 'source' | 'groupId' | 'tagIds' | 'defaultCountryCode'
> & {
  consentConfirmed?: boolean;
  /** The notice the file's contacts agreed under, and its version (kept as proof with each recorded consent). */
  consentNoticeText?: string;
  consentNoticeVersion?: string;
};

async function upload<T>(
  path: string,
  file: File,
  options: ImportOptions,
  parse: (json: unknown) => T,
  signal?: AbortSignal,
): Promise<T> {
  const form = new FormData();
  form.set('file', file);
  form.set('options', JSON.stringify(options));
  const res = await fetch(`/api/v2${path}`, {
    method: 'POST',
    body: form,
    headers: {
      Accept: 'application/json',
      'X-Request-Id': crypto.randomUUID(),
      'Idempotency-Key': crypto.randomUUID(),
    },
    credentials: 'same-origin',
    signal,
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw toApiError(res.status, json, res.headers.get('x-request-id'));
  return parse(json);
}

/** Writes nothing: columns detected, sample rows, what would be created or updated, the plan quota. */
export const previewImport = (file: File, options: ImportOptions, signal?: AbortSignal) =>
  upload(
    '/contacts/import/preview',
    file,
    options,
    (j) => contactImportPreviewSchema.parse(j),
    signal,
  );

/** Up to 1,000 rows run inside the request; a bigger file answers 202 with a queued job to follow. */
export const startImport = (file: File, options: ImportOptions) =>
  upload('/contacts/import', file, options, (j) => contactImportJobSchema.parse(j));

export const getImportJob = (id: string, signal?: AbortSignal): Promise<ContactImportJob> =>
  apiFetch(`/contacts/import/jobs/${id}`, { schema: contactImportJobSchema, signal });

export const isImportFinished = (job: ContactImportJob) =>
  job.status === 'completed' || job.status === 'failed';

/** A saved export's CSV, downloaded again from the history (kept 30 days). */
export async function downloadSavedExport(fileId: string): Promise<Blob> {
  const res = await fetch(`/api/v2/contacts/exports/${fileId}/download`, {
    headers: { Accept: 'text/csv', 'X-Request-Id': crypto.randomUUID() },
    credentials: 'same-origin',
  });
  if (!res.ok) throw toApiError(res.status, undefined, res.headers.get('x-request-id'));
  return res.blob();
}

/** The rows that were not imported, with the reason, as the CSV the API builds. */
export async function downloadRejects(jobId: string): Promise<Blob> {
  const res = await fetch(`/api/v2/contacts/import/jobs/${jobId}/rejects`, {
    headers: { Accept: 'text/csv', 'X-Request-Id': crypto.randomUUID() },
    credentials: 'same-origin',
  });
  if (!res.ok) throw toApiError(res.status, undefined, res.headers.get('x-request-id'));
  return res.blob();
}

/** The sample file, built from the importer's own header names (the same constants the API serves). */
export function sampleCsv(): string {
  const line = (cells: readonly string[]) =>
    `${cells.map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')}\r\n`;
  return line(IMPORT_SAMPLE_HEADERS) + IMPORT_SAMPLE_ROWS.map(line).join('');
}

export type { ContactImportPreview, ImportField };
