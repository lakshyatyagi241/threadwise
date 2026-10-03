import { z } from 'zod';

/**
 * The companies screens parse with the wire shapes of `@crm/contracts` directly: a company already arrives flat, with uuid ids,
 * nested `{id, name}` refs and its rollup, so no mapping layer is needed. This file gathers the names the feature uses and adds
 * the few shapes that belong to other domains' endpoints (members, a contact search hit, a deal row).
 */
export {
  companyActivityPageSchema,
  companyBulkResultSchema,
  companyContactsPageSchema,
  companyIndustriesResponseSchema,
  companyPageResponseSchema,
  companyResponseSchema,
  companySelectItemSchema,
  companyStatsResponseSchema,
  dealResponseSchema,
  type CompanyActivityEntry,
  type CompanyBulkResult,
  type CompanyContact,
  type CompanyResponse,
  type CompanySelectItem,
  type CompanyStatsResponse,
  type CreateCompanyInput,
  type DealResponse,
  type MoneyTotal,
  type UpdateCompanyInput,
} from '@crm/contracts';

export interface Member {
  id: string;
  fullName: string;
}

/** Only what the owner picker reads; the rest of the response is ignored. */
export const memberPageSchema = z.object({
  data: z.array(z.object({ id: z.string(), fullName: z.string() })),
});

/** A contact as the "link contacts" picker needs it: what to show, and which company it is in already. */
export const contactHitSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  companyId: z.string().nullable(),
});
export type ContactHit = z.infer<typeof contactHitSchema>;
export const contactHitPageSchema = z.object({ data: z.array(contactHitSchema) });

export interface BulkOutcome {
  changed: number;
  failed: number;
}
