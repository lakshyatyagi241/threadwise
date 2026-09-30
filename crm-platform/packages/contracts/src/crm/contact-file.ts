import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';

/**
 * File metadata attached to a contact — the detail page's Files tab.
 *
 * This records where a file ended up, not how it got there: actual
 * upload/storage (presigned URLs, size/MIME enforcement) is Phase 9's
 * (File Manager) job. `storageKey` is caller-supplied.
 */
export const contactFileResponseSchema = z.object({
  id: uuidSchema,
  contactId: uuidSchema,
  fileName: z.string(),
  fileSizeBytes: z.number().int().nullable(),
  storageKey: z.string(),
  mimeType: z.string().nullable(),
  uploadedBy: uuidSchema.nullable(),
  createdAt: z.string().datetime(),
});
export type ContactFileResponse = z.infer<typeof contactFileResponseSchema>;

export const createContactFileSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileSizeBytes: z.number().int().positive().optional(),
  storageKey: z.string().min(1).max(1000),
  mimeType: z.string().max(255).optional(),
});
export type CreateContactFileInput = z.infer<typeof createContactFileSchema>;

export const listContactFilesQuerySchema = paginationQuerySchema;
export type ListContactFilesQuery = z.infer<typeof listContactFilesQuerySchema>;
