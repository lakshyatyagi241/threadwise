import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/** AI Training knowledge entries: what an assistant is taught from (a page, a file, pasted text, one Q&A). */

export const AIAG_SOURCE_KINDS = ['url', 'text', 'qa', 'file'] as const;
export type AiagSourceKind = (typeof AIAG_SOURCE_KINDS)[number];
/** `processing`: a page or a PDF still being read in the background; `failed` carries the reason in `error`. */
export const AIAG_SOURCE_STATUSES = ['ready', 'processing', 'failed'] as const;
export type AiagSourceStatus = (typeof AIAG_SOURCE_STATUSES)[number];

export const AIAG_SOURCE_LIMITS = {
  label: 200,
  url: 1024,
  content: 200_000,
  question: 5000,
  answer: 20_000,
  /** A page's extracted text is cut here. */
  urlText: 80_000,
  /** A file's size cap (PDF and DOCX run larger than plain text). */
  fileBytes: 10 * 1024 * 1024,
} as const;

/** The file types the upload takes (extension, lower case). Legacy `.doc` is refused with a hint. */
export const AIAG_FILE_EXTENSIONS = [
  'txt',
  'md',
  'markdown',
  'text',
  'csv',
  'log',
  'html',
  'htm',
  'pdf',
  'docx',
] as const;

const label = z
  .string()
  .trim()
  .min(1, 'Add a label so you can find this entry later.')
  .max(AIAG_SOURCE_LIMITS.label);

/** A page to fetch, pasted text, or one question with its answer. A file goes through the multipart upload instead. */
export const addAiagSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('url'),
    label,
    url: z.string().trim().min(1, 'A URL is required.').max(AIAG_SOURCE_LIMITS.url),
  }),
  z.object({
    kind: z.literal('text'),
    label,
    content: z
      .string()
      .max(AIAG_SOURCE_LIMITS.content)
      .refine((v) => v.trim() !== '', 'Content is required.'),
  }),
  z.object({
    kind: z.literal('qa'),
    label,
    question: z
      .string()
      .max(AIAG_SOURCE_LIMITS.question)
      .refine((v) => v.trim() !== '', 'A question is required.'),
    answer: z
      .string()
      .max(AIAG_SOURCE_LIMITS.answer)
      .refine((v) => v.trim() !== '', 'An answer is required.'),
  }),
]);
export type AddAiagSourceInput = z.infer<typeof addAiagSourceSchema>;

/** The text fields of the multipart upload (the file itself is the `file` part). */
export const uploadAiagSourceFieldsSchema = z.object({ label });
export type UploadAiagSourceFields = z.infer<typeof uploadAiagSourceFieldsSchema>;

export const aiagSourceSchema = z.object({
  id: uuidSchema,
  /** Always the assistant it belongs to: a knowledge base is one agent's. Null only for a leftover agent-less row, which nobody reads. */
  assistantId: uuidSchema.nullable(),
  kind: z.enum(AIAG_SOURCE_KINDS),
  label: z.string(),
  url: z.string().nullable(),
  status: z.enum(AIAG_SOURCE_STATUSES),
  /** About one token per four characters of the text the assistant reads. */
  tokensEstimate: z.number().int().nullable(),
  error: z.string().nullable(),
  /** A stored file backs the entry. The path never leaves the server. */
  hasFile: z.boolean(),
  createdAt: z.string(),
});
export type AiagSource = z.infer<typeof aiagSourceSchema>;

export const listAiagSourcesResponseSchema = z.object({ data: z.array(aiagSourceSchema) });
export type ListAiagSourcesResponse = z.infer<typeof listAiagSourcesResponseSchema>;
