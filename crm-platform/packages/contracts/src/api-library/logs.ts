import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';
import { numberedPageResponseSchema } from './paging';
import { apiLibraryErrorKindSchema } from './run';

export const API_LIBRARY_LOG_SOURCES = ['test', 'flow', 'automation'] as const;
export const apiLibraryLogSourceSchema = z.enum(API_LIBRARY_LOG_SOURCES);
export type ApiLibraryLogSource = z.infer<typeof apiLibraryLogSourceSchema>;

/**
 * Logs are kept 30 days (a daily sweep deletes older rows). Secrets are masked before they are stored: secret headers, query
 * parameters and JSON keys that read like a secret show `API_LIBRARY_SECRET_MASK`. Bodies are cut (request 16 KB, response 16 KB).
 */
export const API_LIBRARY_LOG_RETENTION_DAYS = 30;

export const apiLibraryLogItemSchema = z.object({
  id: uuidSchema,
  /** The API that ran. Null for a test of a definition that was never saved. The id outlives the API (a deleted API's log stays; `apiName` remembers it). */
  apiId: uuidSchema.nullable(),
  apiName: z.string(),
  source: apiLibraryLogSourceSchema,
  method: z.string(),
  url: z.string(),
  ok: z.boolean(),
  statusCode: z.number().int().nullable(),
  durationMs: z.number().int(),
  errorKind: apiLibraryErrorKindSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ApiLibraryLogItem = z.infer<typeof apiLibraryLogItemSchema>;

export const apiLibraryLogDetailSchema = apiLibraryLogItemSchema.extend({
  requestHeaders: z.record(z.string()),
  requestBody: z.string().nullable(),
  responseHeaders: z.record(z.union([z.string(), z.array(z.string())])),
  responseBody: z.string().nullable(),
  /** The stored response body was cut. */
  responseTruncated: z.boolean(),
  /** Who or what ran it: the contact and flow run for a flow, the user for a test. */
  context: z.object({
    contactId: uuidSchema.nullable(),
    flowId: uuidSchema.nullable(),
    flowRunId: uuidSchema.nullable(),
    flowNodeId: z.string().nullable(),
    userId: uuidSchema.nullable(),
  }),
});
export type ApiLibraryLogDetail = z.infer<typeof apiLibraryLogDetailSchema>;

export const listApiLibraryLogsQuerySchema = paginationQuerySchema.extend({
  /** Numbered pages: 1-based. Present: offset pagination (`cursor` is ignored) and the answer carries the totals. Absent: cursor mode. */
  page: z.coerce.number().int().min(1).max(100000).optional(),
  apiId: uuidSchema.optional(),
  status: z.enum(['success', 'failed']).optional(),
  /** An exact HTTP status code. */
  statusCode: z.coerce.number().int().min(100).max(599).optional(),
  source: apiLibraryLogSourceSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** Matches the URL, the API name and the error text, ignoring case. */
  search: z.string().trim().max(200).optional(),
});
export type ListApiLibraryLogsQuery = z.infer<typeof listApiLibraryLogsQuerySchema>;

export const listApiLibraryLogsResponseSchema = numberedPageResponseSchema(apiLibraryLogItemSchema);
export type ListApiLibraryLogsResponse = z.infer<typeof listApiLibraryLogsResponseSchema>;
