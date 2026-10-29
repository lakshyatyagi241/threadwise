import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';

/**
 * File metadata attached to a contact — the detail page's Files tab.
 *
 * Uploaded files (`POST /contacts/:id/files/upload`) get their key from the chat media door and their size and
 * type from the server's reading of the bytes. `storageKey` is caller-supplied only on the record-only route.
 */
export const contactFileResponseSchema = z.object({
  id: uuidSchema,
  contactId: uuidSchema,
  fileName: z.string(),
  fileSizeBytes: z.int().nullable(),
  storageKey: z.string(),
  mimeType: z.string().nullable(),
  uploadedBy: uuidSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type ContactFileResponse = z.infer<typeof contactFileResponseSchema>;

/**
 * AZ-009: a file reference is a name and a relative storage key, never a path that leaves its folder. A name carries no
 * separator; a key has no `..` segment, no backslash, no leading `/`, no drive letter or URL scheme and no control
 * character. (That a workspace-scoped key belongs to the caller's workspace is checked by the service, which knows it.)
 */
const hasControlChar = (v: string): boolean => [...v].some((c) => c.charCodeAt(0) < 32);
const safeFileName = z
  .string()
  .min(1)
  .max(255)
  .refine((v) => !/[\\/]/.test(v) && v !== '.' && v !== '..' && !hasControlChar(v), {
    error: 'must be a plain file name without path separators',
  });
const safeStorageKey = z
  .string()
  .min(1)
  .max(1000)
  .refine(
    (v) =>
      !v.startsWith('/') &&
      !v.includes('\\') &&
      !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v) &&
      !v.split('/').some((seg) => seg === '..' || seg === '.') &&
      !hasControlChar(v),
    {
      error: 'must be a relative storage key without ".." segments, backslashes or a scheme',
    },
  );

export const createContactFileSchema = z.object({
  fileName: safeFileName,
  fileSizeBytes: z.int().positive().optional(),
  storageKey: safeStorageKey,
  mimeType: z.string().max(255).optional(),
});
export type CreateContactFileInput = z.infer<typeof createContactFileSchema>;

export const listContactFilesQuerySchema = paginationQuerySchema;
export type ListContactFilesQuery = z.infer<typeof listContactFilesQuerySchema>;
