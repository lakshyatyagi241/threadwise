import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';
import { numberedPageResponseSchema } from './paging';
import {
  apiLibraryBodySchema,
  apiLibraryHeaderSchema,
  apiLibraryMappingSchema,
  apiLibraryMethodSchema,
  apiLibraryPayloadTypeSchema,
  apiLibraryVariableSchema,
} from './definition';

/** One row of the list screen (name, method, dates and the Logs / Edit / Delete actions). */
export const apiLibraryItemSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  method: apiLibraryMethodSchema,
  /** The URL template as saved (tokens included). Query-string secrets are not hidden here: put keys in a header. */
  url: z.string(),
  payloadType: apiLibraryPayloadTypeSchema,
  hasFunction: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type ApiLibraryItem = z.infer<typeof apiLibraryItemSchema>;

/** The edit form. Header values of secret headers read as `API_LIBRARY_SECRET_MASK`; no route returns the stored secret. */
export const apiLibraryDetailSchema = apiLibraryItemSchema.extend({
  variables: z.array(apiLibraryVariableSchema),
  headers: z.array(apiLibraryHeaderSchema),
  body: apiLibraryBodySchema,
  functionCode: z.string().nullable(),
  mapping: z.array(apiLibraryMappingSchema),
  responseVariables: z.array(z.string()),
  createdById: uuidSchema.nullable(),
});
export type ApiLibraryDetail = z.infer<typeof apiLibraryDetailSchema>;

export const listApiLibraryApisQuerySchema = paginationQuerySchema.extend({
  /** Numbered pages: 1-based. Present: offset pagination (`cursor` is ignored) and the answer carries the totals. Absent: cursor mode. */
  page: z.coerce.number().int().min(1).max(100000).optional(),
  /** Matches the name or the URL, ignoring case. */
  search: z.string().trim().max(200).optional(),
  method: apiLibraryMethodSchema.optional(),
});
export type ListApiLibraryApisQuery = z.infer<typeof listApiLibraryApisQuerySchema>;

export const listApiLibraryApisResponseSchema = numberedPageResponseSchema(apiLibraryItemSchema);
export type ListApiLibraryApisResponse = z.infer<typeof listApiLibraryApisResponseSchema>;

/**
 * The slim feed of the pickers (the flow node's "choose an API" list and the editor's chip menu: APIs -> Name -> Name.field). No URL,
 * headers or body. Readable with `integ.apilibrary.read` or `flb.flows.read`.
 */
export const apiLibraryOptionSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  method: apiLibraryMethodSchema,
  /** The names of the variables the API needs, with their defaults (a flow node lets the author override each). */
  variables: z.array(apiLibraryVariableSchema),
  /** The response paths exposed as `{{Name.<path>}}`. */
  responseVariables: z.array(z.string()),
});
export type ApiLibraryOption = z.infer<typeof apiLibraryOptionSchema>;

export const apiLibraryOptionsResponseSchema = z.object({ data: z.array(apiLibraryOptionSchema) });
export type ApiLibraryOptionsResponse = z.infer<typeof apiLibraryOptionsResponseSchema>;

/** Something that uses the API. Only flows today; the automation builder joins when it exists. */
export const apiLibraryUsageItemSchema = z.object({
  kind: z.enum(['flow']),
  id: uuidSchema,
  name: z.string(),
  published: z.boolean(),
  /** How many nodes of that flow call this API. */
  nodeCount: z.number().int(),
});
export type ApiLibraryUsageItem = z.infer<typeof apiLibraryUsageItemSchema>;

export const apiLibraryUsageResponseSchema = z.object({ data: z.array(apiLibraryUsageItemSchema) });
export type ApiLibraryUsageResponse = z.infer<typeof apiLibraryUsageResponseSchema>;

/** `?force=true` deletes an API that flows still use (their node then leaves by its `error` port). */
export const deleteApiLibraryApiQuerySchema = z.object({
  force: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export type DeleteApiLibraryApiQuery = z.infer<typeof deleteApiLibraryApiQuerySchema>;

/** A contact property a response field can be saved into (visible, writable: the contact's own text fields and the active custom ones). */
export const apiLibraryContactPropertySchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(['system', 'custom']),
});
export type ApiLibraryContactProperty = z.infer<typeof apiLibraryContactPropertySchema>;

export const apiLibraryContactPropertiesResponseSchema = z.object({
  data: z.array(apiLibraryContactPropertySchema),
});
export type ApiLibraryContactPropertiesResponse = z.infer<
  typeof apiLibraryContactPropertiesResponseSchema
>;
