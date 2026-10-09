import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import {
  apiLibraryDefinitionObject,
  apiLibraryNameSchema,
  apiLibraryVariableSchema,
  withApiLibraryDefinitionRules,
} from './definition';

/**
 * Test run of a definition that is not saved yet (or saved and being edited): the sandbox processes the payload, the request goes out
 * through the guarded fetcher, and the outcome is logged (source `test`). `apiId` lets a secret header the form holds as
 * `API_LIBRARY_SECRET_MASK` use the stored value.
 */
export const testApiLibraryApiSchema = withApiLibraryDefinitionRules(
  z.object({
    ...apiLibraryDefinitionObject.shape,
    name: apiLibraryNameSchema.optional(),
    apiId: uuidSchema.optional(),
    /** Overrides for the declared variables (name -> value) for this run only. */
    values: z.record(z.string().max(2000)).default({}),
  }),
);
export type TestApiLibraryApiInput = z.infer<typeof testApiLibraryApiSchema>;

/** Why a run did not succeed. Null when it did. */
export const API_LIBRARY_ERROR_KINDS = [
  'blocked', // the address is private/internal or does not resolve
  'function', // the processing function threw, timed out or returned nothing usable
  'timeout',
  'network', // could not connect, reset, response too large to read
  'status', // the server answered, but not 2xx
  'invalid', // the request could not be built (bad URL after substitution, missing API)
] as const;
export const apiLibraryErrorKindSchema = z.enum(API_LIBRARY_ERROR_KINDS);
export type ApiLibraryErrorKind = z.infer<typeof apiLibraryErrorKindSchema>;

export const apiLibraryRunRequestSchema = z.object({
  method: z.string(),
  /** After variable substitution; secret-looking query parameters masked. */
  url: z.string(),
  /** After substitution; secret headers masked. */
  headers: z.record(z.string()),
  /** The body as sent (after the processing function), secret-looking keys masked, as text. Null: no body. */
  body: z.string().nullable(),
});

export const apiLibraryRunResponseSchema = z.object({
  headers: z.record(z.union([z.string(), z.array(z.string())])),
  contentType: z.string().nullable(),
  /** The body as text, cut at 64 KB. */
  bodyText: z.string(),
  /** The body parsed as JSON (what the response tree and the path pickers read); null when it is not JSON or was cut. */
  bodyJson: z.unknown().nullable(),
  truncated: z.boolean(),
  sizeBytes: z.number().int(),
});

export const testApiLibraryApiResponseSchema = z.object({
  ok: z.boolean(),
  /** The HTTP status of the target's answer; null when there was none (blocked, timeout, network). */
  status: z.number().int().nullable(),
  durationMs: z.number().int(),
  errorKind: apiLibraryErrorKindSchema.nullable(),
  error: z.string().nullable(),
  request: apiLibraryRunRequestSchema.nullable(),
  response: apiLibraryRunResponseSchema.nullable(),
  /** What the processing function returned (the payload that was sent). Null when there is no function. */
  processedPayload: z.unknown().nullable(),
  /** The log entry of this run (null only if writing the log failed; the run itself still happened). */
  logId: uuidSchema.nullable(),
});
export type TestApiLibraryApiResponse = z.infer<typeof testApiLibraryApiResponseSchema>;

/** The form's "Run code" button: runs the function alone on a sample payload (variables replaced by their defaults). */
export const testApiLibraryFunctionSchema = z.object({
  functionCode: z.string().min(1).max(20_000),
  payload: z.unknown(),
  variables: z.array(apiLibraryVariableSchema).max(50).default([]),
});
export type TestApiLibraryFunctionInput = z.infer<typeof testApiLibraryFunctionSchema>;

export const testApiLibraryFunctionResponseSchema = z.object({
  ok: z.boolean(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  durationMs: z.number().int(),
});
export type TestApiLibraryFunctionResponse = z.infer<typeof testApiLibraryFunctionResponseSchema>;
