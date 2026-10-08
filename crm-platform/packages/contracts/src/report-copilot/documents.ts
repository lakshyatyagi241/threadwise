import { z } from 'zod';

/** Where the assistant runs: a workspace's dashboard, or the operator's platform overview. */
export const REPORT_SCOPES = ['workspace', 'platform'] as const;
export const reportScopeSchema = z.enum(REPORT_SCOPES);
export type ReportScope = z.infer<typeof reportScopeSchema>;

export const REPORT_DOCUMENT_LIMITS = {
  /** One file, in bytes. */
  fileBytes: 10 * 1024 * 1024,
  /** Documents kept per workspace (and for the platform library). */
  maxDocuments: 25,
  /** Extracted text kept per document; a longer file is cut and flagged `truncated`. */
  maxChars: 400_000,
  /** What one `read_document` tool call hands the model. */
  readChunkChars: 12_000,
} as const;

/** Extensions the extractor reads (PDF, DOCX, and text-like files). */
export const REPORT_DOCUMENT_EXTENSIONS = [
  'pdf',
  'docx',
  'txt',
  'md',
  'csv',
  'html',
  'htm',
  'json',
] as const;

export const reportDocumentStatusSchema = z.enum(['ready', 'failed']);

export const reportDocumentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  extension: z.string(),
  mime: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  /** Characters of text read from the file. */
  charCount: z.number().int().nonnegative(),
  /** The file held more text than the limit; the end was dropped. */
  truncated: z.boolean(),
  status: reportDocumentStatusSchema,
  /** Why a `failed` document could not be read. */
  failureReason: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type ReportDocument = z.infer<typeof reportDocumentSchema>;

export const reportDocumentListResponseSchema = z.object({
  data: z.array(reportDocumentSchema),
  limit: z.number().int(),
});
export type ReportDocumentListResponse = z.infer<typeof reportDocumentListResponseSchema>;

/** Multipart fields next to `file`: an optional display name (defaults to the file name). */
export const uploadReportDocumentFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});
export type UploadReportDocumentFields = z.infer<typeof uploadReportDocumentFieldsSchema>;

/** The window the assistant's numbers cover, as the dashboard's own filters name it. */
export const reportWindowSchema = z.enum(['7d', '30d', '90d']);
export type ReportWindow = z.infer<typeof reportWindowSchema>;

/** The largest request body the assistant's runtime accepts (the chat history, the screen's readable context and the tool schemas). */
export const REPORT_RUNTIME_MAX_BODY_BYTES = 512 * 1024;

/** Why the assistant cannot answer right now; `null` in the status when it can. */
export const reportCopilotStatusSchema = z.object({
  ready: z.boolean(),
  reason: z.enum(['key_missing', 'provider_unsupported', 'allowance_used']).nullable(),
  /** The vendor the next answer would use, when one resolves. */
  provider: z.string().nullable(),
  /** Which side pays for it: the workspace's own key or the platform's. */
  keySource: z.enum(['workspace', 'platform']).nullable(),
});
export type ReportCopilotStatus = z.infer<typeof reportCopilotStatusSchema>;
