import {
  SEGMENT_DESCRIPTION_MAX,
  SEGMENT_NAME_MAX,
  SEGMENT_SHARE_MAX,
  addSegmentToGroupSchema,
  contactResponseSchema,
  createSegmentSchema,
  pageResponseSchema,
  previewSegmentSchema,
  segmentActionResponseSchema,
  segmentCountResponseSchema,
  segmentPreviewResponseSchema,
  segmentResponseSchema,
  tagSegmentSchema,
  updateSegmentSchema,
  type AddSegmentToGroupInput,
  type CreateSegmentInput,
  type InvalidCondition,
  type PreviewSegmentInput,
  type SegmentActionResponse,
  type SegmentCountResponse,
  type SegmentPreviewResponse,
  type SegmentResponse,
  type SegmentRules,
  type SegmentVisibility,
  type TagSegmentInput,
  type UpdateSegmentInput,
} from '@crm/contracts';
import { z } from 'zod';

/**
 * Everything the segments screens parse and send is the contract in `@crm/contracts` (`segments/`); this file gathers
 * the names the feature uses and adds the one envelope the contracts leave to the caller (the members page, which is
 * the contacts page).
 */

export {
  SEGMENT_DESCRIPTION_MAX,
  SEGMENT_NAME_MAX,
  SEGMENT_SHARE_MAX,
  addSegmentToGroupSchema,
  createSegmentSchema,
  previewSegmentSchema,
  segmentActionResponseSchema,
  segmentCountResponseSchema,
  segmentPreviewResponseSchema,
  segmentResponseSchema,
  tagSegmentSchema,
  updateSegmentSchema,
};
export type {
  AddSegmentToGroupInput,
  CreateSegmentInput,
  InvalidCondition,
  PreviewSegmentInput,
  SegmentActionResponse,
  SegmentCountResponse,
  SegmentPreviewResponse,
  SegmentResponse,
  SegmentRules,
  SegmentVisibility,
  TagSegmentInput,
  UpdateSegmentInput,
};

export type Segment = SegmentResponse;

/** `GET /segments/:id/contacts`: the contacts cursor page, with `meta.total` when the request asked for `includeTotal`. */
export const segmentMembersPageSchema = pageResponseSchema(contactResponseSchema).extend({
  meta: z.object({ total: z.number().int().nonnegative() }).optional(),
});
export type SegmentMembersPage = z.infer<typeof segmentMembersPageSchema>;

/** Only what the owner and share pickers read of `GET /users`. */
export const personSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  email: z.string().optional(),
  status: z.string().optional(),
});
export type Person = z.infer<typeof personSchema>;

/** Only what the share picker reads of `GET /workspace/teams`. */
export const teamOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  members: z.array(z.unknown()).optional(),
});
export type TeamOption = z.infer<typeof teamOptionSchema>;
