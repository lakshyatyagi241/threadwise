import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';
import { FLOW_TYPES, MESSAGING_FLOW_TYPES, flbIsFlowType, type FlowType } from './node-catalogue';
import { FLB_MAX_FLOW_EDGES, FLB_MAX_FLOW_NODES } from './graph';

/**
 * Flows API shapes (TW-FLB-001..029). Identifiers are uuids; the graph is Reference's `{ flowNodes, flowEdges, vars }`.
 */

/**
 * `max:n` the way Reference's validator counts it: characters (code points), not UTF-16 units, so a name of 191 emoji is accepted and
 * 192 is not. `.max()` of zod counts units and would refuse a 191-emoji name.
 */
export const flbMaxChars =
  (max: number) =>
  (value: string, ctx: z.RefinementCtx): void => {
    if ([...value].length > max)
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        type: 'string',
        maximum: max,
        inclusive: true,
        message: `String must contain at most ${max} character(s)`,
      });
  };

export const FLOW_NAME_MAX = 255;
/** The rename dialog and endpoint allow fewer characters than Save does (Reference: 191 vs 255); kept. */
export const FLOW_RENAME_MAX = 191;
export const FLOW_CATEGORY_MAX = 64;
export const FLOW_PAGE_SIZE = 12;
export const FLOW_IMPORT_MAX_BYTES = 4096 * 1024;
export const FLOW_EXPORT_MARKER = '_threadwise_flow_export';

export const flowTypeSchema = z.enum(FLOW_TYPES);
export const flowStateSchema = z.enum(['live', 'paused', 'draft']);
export type FlowState = z.infer<typeof flowStateSchema>;
export const flowStatusFilterSchema = z.enum(['all', 'live', 'paused', 'draft']);
export type FlowStatusFilter = z.infer<typeof flowStatusFilterSchema>;

/** Published AND active is live, published and not active is paused, unpublished is always a draft (even when inactive). */
export function flowState(f: { isPublished: boolean; isActive: boolean }): FlowState {
  if (!f.isPublished) return 'draft';
  return f.isActive ? 'live' : 'paused';
}

// --- graph on the wire -------------------------------------------------------------------------------------------

export const flowGraphInputSchema = z.object({
  flowNodes: z
    .array(z.record(z.unknown()))
    .max(FLB_MAX_FLOW_NODES, `A flow can hold at most ${FLB_MAX_FLOW_NODES} nodes.`),
  flowEdges: z.array(z.record(z.unknown())).max(FLB_MAX_FLOW_EDGES).default([]),
  vars: z.array(z.record(z.unknown())).default([]),
});
export type FlowGraphInput = z.infer<typeof flowGraphInputSchema>;

const nodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  x: z.number(),
  y: z.number(),
  data: z.record(z.unknown()),
  isStart: z.boolean().optional(),
});
const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceHandle: z.string(),
  target: z.string(),
});
export const flowGraphSchema = z.object({
  flowNodes: z.array(nodeSchema),
  flowEdges: z.array(edgeSchema),
  vars: z.array(
    z.object({ name: z.string(), desc: z.string().optional(), default: z.string().optional() }),
  ),
});

// --- list --------------------------------------------------------------------------------------------------------

export const flowSubscriberCountsSchema = z.object({
  active: z.number().int(),
  completed: z.number().int(),
  failed: z.number().int(),
});

export const flowSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  flowType: flowTypeSchema,
  category: z.string().nullable(),
  state: flowStateSchema,
  isPublished: z.boolean(),
  isActive: z.boolean(),
  triggerKind: z.string(),
  nodeCount: z.number().int(),
  edgeCount: z.number().int(),
  subscribers: flowSubscriberCountsSchema,
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type FlowSummary = z.infer<typeof flowSummarySchema>;

export const listFlowsQuerySchema = z.object({
  status: flowStatusFilterSchema.default('all'),
  category: z.string().max(FLOW_CATEGORY_MAX).default('all'),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(FLOW_PAGE_SIZE),
  cursor: z.string().min(1).max(512).optional(),
  includeTotal: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((v) => v === true || v === 'true' || v === '1')
    .default(false),
});
export type ListFlowsQuery = z.infer<typeof listFlowsQuerySchema>;

export const listFlowsResponseSchema = z.object({
  data: z.array(flowSummarySchema),
  page: pageInfoSchema,
  /** The filtered total, present when `includeTotal` was asked for. */
  total: z.number().int().optional(),
});
export type ListFlowsResponse = z.infer<typeof listFlowsResponseSchema>;

export const flowFeaturedSchema = flowSummarySchema.extend({
  steps: z.number().int(),
  messages: z.number().int(),
  waitMinutes: z.number(),
  /** The first four nodes with a type, for the card's mini preview: the type styles the row, the label is Reference's text for it. */
  preview: z.array(z.object({ type: z.string(), label: z.string() })),
});
export type FlowFeatured = z.infer<typeof flowFeaturedSchema>;

export const flowTemplateCardSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  flowType: flowTypeSchema,
  category: z.string().nullable(),
  steps: z.number().int(),
});
export type FlowTemplateCard = z.infer<typeof flowTemplateCardSchema>;

/** KPI tiles, the library rail, the status rail, the featured card and the template gallery: everything filter-independent. */
export const flowsOverviewSchema = z.object({
  statusCounts: z.object({
    all: z.number().int(),
    live: z.number().int(),
    paused: z.number().int(),
    draft: z.number().int(),
  }),
  /** Counts by `COALESCE(category, 'uncategorized')`, plus `all`. */
  categoryCounts: z.record(z.number().int()),
  featured: flowFeaturedSchema.nullable(),
  templates: z.array(flowTemplateCardSchema),
});
export type FlowsOverview = z.infer<typeof flowsOverviewSchema>;

// --- detail / save -----------------------------------------------------------------------------------------------

export const flowDetailSchema = flowSummarySchema.extend({
  graph: flowGraphSchema,
});
export type FlowDetail = z.infer<typeof flowDetailSchema>;

export const saveFlowRequestSchema = z.object({
  name: z.string().trim().min(1, 'Flow name is required').superRefine(flbMaxChars(FLOW_NAME_MAX)),
  category: z.string().trim().superRefine(flbMaxChars(FLOW_CATEGORY_MAX)).nullish(),
  flowType: flowTypeSchema.nullish(),
  graph: flowGraphInputSchema,
});
export type SaveFlowRequest = z.infer<typeof saveFlowRequestSchema>;

export const updateFlowRequestSchema = saveFlowRequestSchema.extend({
  rowVersion: z.number().int().min(1),
});
export type UpdateFlowRequest = z.infer<typeof updateFlowRequestSchema>;

export const renameFlowRequestSchema = z.object({
  name: z.string().trim().min(1, 'Flow name is required').superRefine(flbMaxChars(FLOW_RENAME_MAX)),
});
export type RenameFlowRequest = z.infer<typeof renameFlowRequestSchema>;

export const toggleFlowResponseSchema = z.object({ isActive: z.boolean(), state: flowStateSchema });
export type ToggleFlowResponse = z.infer<typeof toggleFlowResponseSchema>;

// --- import / export ---------------------------------------------------------------------------------------------

export const importFlowRequestSchema = z.object({
  /** The parsed JSON of an export file, or a bare `{ flowNodes, flowEdges, vars }` graph. */
  payload: z.record(z.unknown()),
});
export type ImportFlowRequest = z.infer<typeof importFlowRequestSchema>;

export const flowExportSchema = z.object({
  _threadwise_flow_export: z.literal(1),
  exported_at: z.string(),
  name: z.string(),
  flow_type: flowTypeSchema,
  category: z.string().nullable(),
  flow_data: flowGraphSchema,
});
export type FlowExport = z.infer<typeof flowExportSchema>;

// --- builder context (pickers) -------------------------------------------------------------------------------------

export const flowSenderSchema = z.object({
  /** The composite sender key stored on the Trigger node: `<engine>:<uuid>`. */
  key: z.string(),
  label: z.string(),
  phone: z.string().nullable().optional(),
  engineLabel: z.string().nullable().optional(),
});
export type FlowSender = z.infer<typeof flowSenderSchema>;

export const flowTemplateOptionSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  category: z.string().nullable(),
  header: z.string().nullable(),
  body: z.string().nullable(),
  footer: z.string().nullable(),
  attachmentType: z.string().nullable(),
  attachmentFile: z.string().nullable(),
  buttons: z.array(z.record(z.unknown())),
  carousel: z.array(z.record(z.unknown())),
});

/** A connected store a commerce node can sell from. `currency` is null for a WhatsApp catalog (mixed currencies). */
export const flbStoreSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  currency: z.string().nullable(),
});
export type FlbStore = z.infer<typeof flbStoreSchema>;

export const flbBuilderContextSchema = z.object({
  /** Channels this workspace can run a flow on (WhatsApp always); an unavailable channel is never offered. */
  channels: z.array(flowTypeSchema),
  senders: z.object({
    chat: z.array(flowSenderSchema),
    instagram: z.array(flowSenderSchema),
    facebook: z.array(flowSenderSchema),
    tiktok: z.array(flowSenderSchema),
    telegram: z.array(flowSenderSchema),
    line: z.array(flowSenderSchema),
    wechat: z.array(flowSenderSchema),
    viber: z.array(flowSenderSchema),
    email: z.array(flowSenderSchema),
  }),
  tags: z.array(z.object({ id: uuidSchema, name: z.string(), color: z.string().nullable() })),
  groups: z.array(z.object({ id: uuidSchema, name: z.string() })),
  keywordRules: z.array(z.object({ id: uuidSchema, keyword: z.string(), active: z.boolean() })),
  teams: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      members: z.array(z.object({ id: uuidSchema, name: z.string() })),
    }),
  ),
  agents: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      provider: z.string().nullable(),
      model: z.string().nullable(),
    }),
  ),
  stages: z.array(z.object({ id: uuidSchema, name: z.string(), pipeline: z.string().nullable() })),
  templates: z.array(flowTemplateOptionSchema),
  /** The workspace's flows (slim): the channel and published state feed the Sub-flow and hand-off pickers (`<name> · live`). */
  flows: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      flowType: flowTypeSchema,
      isPublished: z.boolean(),
    }),
  ),
  aiModels: z.array(z.object({ value: z.string(), label: z.string(), provider: z.string() })),
  assistants: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      status: z.string().nullable(),
      sources: z.number().int(),
    }),
  ),
  callAssistants: z.array(z.object({ id: uuidSchema, name: z.string() })),
  /** Every booking type, inactive ones included (Reference labels them `(inactive)`), with its length in minutes. */
  bookingTypes: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      duration: z.number().int().nullable(),
      active: z.boolean(),
    }),
  ),
  /** Every WhatsApp form; `isPublished` = published to Meta and live (a draft is listed too, as in Reference). */
  forms: z.array(z.object({ id: uuidSchema, title: z.string(), isPublished: z.boolean() })),
  /** Commerce stores per provider (WhatsApp catalog, WooCommerce, Shopify). */
  stores: z.object({
    whatsapp_shop: z.array(flbStoreSchema),
    woocommerce: z.array(flbStoreSchema),
    shopify: z.array(flbStoreSchema),
  }),
});
export type FlbBuilderContext = z.infer<typeof flbBuilderContextSchema>;

export const FLB_COMMERCE_PROVIDERS = [
  'whatsapp_shop',
  'woocommerce',
  'shopify',
  'instagram',
] as const;
export const flbCommerceProductsQuerySchema = z.object({
  provider: z.enum(FLB_COMMERCE_PROVIDERS),
  storeId: uuidSchema.optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type FlbCommerceProductsQuery = z.infer<typeof flbCommerceProductsQuerySchema>;

/** A product a commerce node can offer. `retailerId` is the id the runtime sends; the rest is for the picker. */
export const flbCommerceProductSchema = z.object({
  /** The product's own id (a uuid), unlike `retailerId` which is what the channel sends. */
  id: z.string(),
  retailerId: z.string(),
  name: z.string(),
  sku: z.string().nullable(),
  image: z.string().nullable(),
  priceMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  /** The product page (the "View" link). */
  url: z.string().nullable(),
  /** False products are shown but cannot be picked (Reference disables them). */
  inStock: z.boolean(),
});
export type FlbCommerceProduct = z.infer<typeof flbCommerceProductSchema>;
export const flbCommerceProductsResponseSchema = z.object({
  data: z.array(flbCommerceProductSchema),
});

export const FLB_GOOGLE_PICKER_KINDS = ['sheets', 'docs', 'forms'] as const;
export const flbGoogleFilesResponseSchema = z.object({
  data: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const FLOW_ENGINE_LABELS: Record<string, string> = {
  baileys: 'Unofficial API',
  waba: 'WhatsApp Business API',
  twilio: 'Twilio',
};

// --- test runner / AI ----------------------------------------------------------------------------------------------

export const flbTestWebhookRequestSchema = z.object({
  /** Required like Reference (its validator rejects a blank url with 422; the builder skips a blank webhook before calling). */
  url: z.string().trim().min(1, 'The url field is required.').max(2048),
  method: z.string().max(10).nullish(),
  body: z.string().nullish(),
  contentType: z.string().max(120).nullish(),
  headers: z
    .array(z.object({ key: z.string().optional(), value: z.string().optional() }))
    .nullish(),
  vars: z.record(z.unknown()).nullish(),
});
export type FlbTestWebhookRequest = z.infer<typeof flbTestWebhookRequestSchema>;

export const flbTestWebhookResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    status: z.number().int(),
    success: z.boolean(),
    response: z.string(),
    json: z.record(z.unknown()).nullable().optional(),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type FlbTestWebhookResponse = z.infer<typeof flbTestWebhookResponseSchema>;

export const FLB_AI_PROVIDERS = ['openai', 'anthropic', 'gemini'] as const;
export const flbAiGenerateRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  model: z.string().min(1).max(120),
  provider: z.enum(FLB_AI_PROVIDERS),
  flowType: flowTypeSchema.nullish(),
});
export type FlbAiGenerateRequest = z.infer<typeof flbAiGenerateRequestSchema>;

export const flbAiGenerateResponseSchema = z.object({
  flow: flowGraphSchema,
  model: z.string(),
});
export type FlbAiGenerateResponse = z.infer<typeof flbAiGenerateResponseSchema>;

export const FLB_AI_GENERATE_MAX_NODES = 20;
export const FLB_AI_GENERATE_MAX_EDGES = 40;

// --- admin (platform) templates --------------------------------------------------------------------------------------

export const FLB_TEMPLATE_FLOW_TYPES = ['chat', 'call', 'instagram'] as const;
export const FLB_TEMPLATE_PAGE_SIZE = 20;

export const adminFlowTemplateSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  flowType: flowTypeSchema,
  category: z.string().nullable(),
  steps: z.number().int(),
  cloneCount: z.number().int(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AdminFlowTemplate = z.infer<typeof adminFlowTemplateSchema>;

export const listAdminFlowTemplatesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(FLB_TEMPLATE_PAGE_SIZE),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListAdminFlowTemplatesQuery = z.infer<typeof listAdminFlowTemplatesQuerySchema>;

export const adminFlowTemplatesResponseSchema = z.object({
  data: z.array(adminFlowTemplateSchema),
  page: pageInfoSchema,
  stats: z.object({ total: z.number().int(), visible: z.number().int(), cloned: z.number().int() }),
});
export type AdminFlowTemplatesResponse = z.infer<typeof adminFlowTemplatesResponseSchema>;

/**
 * A template's graph is stored exactly as the operator supplied it (Reference stores `{flowNodes, flowEdges, vars}` as given, nodes
 * without ids or positions included); it is normalised only when a tenant clones it. So the detail's graph is the loose shape.
 */
export const adminFlowTemplateGraphSchema = z.object({
  flowNodes: z.array(z.record(z.unknown())),
  flowEdges: z.array(z.record(z.unknown())),
  vars: z.array(z.record(z.unknown())),
});
export const adminFlowTemplateDetailSchema = adminFlowTemplateSchema.extend({
  graph: adminFlowTemplateGraphSchema,
});
export type AdminFlowTemplateDetail = z.infer<typeof adminFlowTemplateDetailSchema>;

/** Create and edit share the form. On create the graph is required (one of three sources); on edit it is optional. */
export const adminFlowTemplateFieldsSchema = z.object({
  name: z.string().trim().min(1, 'The name field is required.').superRefine(flbMaxChars(160)),
  description: z.string().trim().superRefine(flbMaxChars(1000)).nullish(),
  flowType: z.enum(FLB_TEMPLATE_FLOW_TYPES),
  category: z.string().trim().superRefine(flbMaxChars(64)).nullish(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});
export const createAdminFlowTemplateSchema = adminFlowTemplateFieldsSchema.extend({
  /** An export wrapper or a bare graph (the uploaded file or the pasted JSON, already parsed). */
  payload: z.record(z.unknown()).optional(),
  /** Or the uuid of an existing flow to clone (any workspace, as Reference's clone-by-id). */
  sourceFlowId: uuidSchema.optional(),
});
export type CreateAdminFlowTemplateInput = z.infer<typeof createAdminFlowTemplateSchema>;
export const updateAdminFlowTemplateSchema = createAdminFlowTemplateSchema.extend({
  rowVersion: z.number().int().min(1),
});
export type UpdateAdminFlowTemplateInput = z.infer<typeof updateAdminFlowTemplateSchema>;

export const FLOW_LIBRARY_CATEGORIES = [
  { key: 'cart', label: 'Cart abandonment' },
  { key: 'welcome', label: 'Welcome' },
  { key: 'post-purchase', label: 'Post-purchase' },
  { key: 're-engagement', label: 'Re-engagement' },
  { key: 'event', label: 'Special events' },
  { key: 'lead', label: 'Lead nurture' },
] as const;

/** `Str::slug` as Reference's export file name uses it: lower case, runs of anything else become one hyphen. */
export function flbSlugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `<slug>.threadwise-flow.json`, or `flow-<id>` when the name has no usable characters. */
export function flbExportFileName(name: string, fallbackId: string): string {
  const slug = flbSlugify(name);
  return `${slug || `flow-${fallbackId}`}.threadwise-flow.json`;
}

export type { FlowType };
export { flbIsFlowType, MESSAGING_FLOW_TYPES };
