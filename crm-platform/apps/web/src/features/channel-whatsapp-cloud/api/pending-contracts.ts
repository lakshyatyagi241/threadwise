import { z } from 'zod';
import { pageResponseSchema, uuidSchema } from '@crm/contracts';

/**
 * PENDING CONTRACTS. The message-template library (`modules/message-templates`, `GET /v2/templates`) is built on `origin/main` but
 * its contracts (`@crm/contracts` message-templates) are not in this branch yet, so the few fields the inbox's template picker
 * reads are declared here, as a subset, and parsed leniently. When the branch has the library's contracts, delete this file and
 * import `templateSummarySchema`, `templateDetailSchema` and `listTemplatesResponseSchema` instead.
 */

/** Where the template stands, local and Meta combined. Only `approved` can be sent outside the 24 hour window. */
export const templateStatusSchema = z.enum([
  'draft',
  'pending',
  'approved',
  'rejected',
  'paused',
  'disabled',
  'deleted',
]);

export const templateSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  language: z.string(),
  metaCategory: z.string().nullish().catch(null),
  status: templateStatusSchema.catch('draft'),
  bodyPreview: z.string().catch(''),
});
export type TemplateSummary = z.infer<typeof templateSummarySchema>;

export const templateListSchema = pageResponseSchema(templateSummarySchema);

/** One slot of a template's text: the placeholder number, and the contact attribute it reads from (or the number itself). */
export const variableSlotSchema = z.object({
  num: z.number().int().min(1),
  key: z.string().catch(''),
  example: z.string().nullish().catch(null),
});
export type VariableSlot = z.infer<typeof variableSlotSchema>;

export const templateDetailSchema = templateSummarySchema.extend({
  header: z.string().nullish().catch(null),
  body: z.string().catch(''),
  footer: z.string().nullish().catch(null),
  variableMap: z
    .object({
      header: z.array(variableSlotSchema).nullish().catch(null),
      body: z.array(variableSlotSchema).nullish().catch(null),
    })
    .nullish()
    .catch(null),
});
export type TemplateDetail = z.infer<typeof templateDetailSchema>;
