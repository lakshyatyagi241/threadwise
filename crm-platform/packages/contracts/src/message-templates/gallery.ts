import { z } from 'zod';

/**
 * The template gallery: ready-made WhatsApp templates the workspace can start from, grouped by use. A gallery template is Meta's own
 * component shape (a header, a body with `{{1}}` variables and sample values, a footer, buttons), so "Use this template" fills the
 * template form from it and nothing else has to be translated.
 */
export const TEMPLATE_GALLERY_CATEGORIES = [
  'ecommerce',
  'food_delivery',
  'festival_season',
  'education',
  'travel',
  'others',
] as const;
export type TemplateGalleryCategory = (typeof TEMPLATE_GALLERY_CATEGORIES)[number];

export const templateGalleryCategorySchema = z.object({
  id: z.enum(TEMPLATE_GALLERY_CATEGORIES),
  name: z.string(),
});

/** One component of a gallery template, as Meta writes it (`type`: HEADER, BODY, FOOTER or BUTTONS). */
export const templateGalleryComponentSchema = z
  .object({
    type: z.enum(['HEADER', 'BODY', 'FOOTER', 'BUTTONS']),
    format: z.string().optional(),
    text: z.string().optional(),
    example: z.record(z.unknown()).optional(),
    buttons: z
      .array(
        z
          .object({
            type: z.string(),
            text: z.string().optional(),
            url: z.string().optional(),
            phone_number: z.string().optional(),
            example: z.union([z.string(), z.array(z.string())]).optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
export type TemplateGalleryComponent = z.infer<typeof templateGalleryComponentSchema>;

export const templateGalleryItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(TEMPLATE_GALLERY_CATEGORIES),
  /** Meta's category the template is submitted under. */
  template_category: z.enum(['MARKETING', 'UTILITY']),
  /** `none` when the template has no buttons. */
  button_type: z.string(),
  components: z.array(templateGalleryComponentSchema),
});
export type TemplateGalleryItem = z.infer<typeof templateGalleryItemSchema>;

export const templateGalleryQuerySchema = z.object({
  category: z.enum(TEMPLATE_GALLERY_CATEGORIES).optional(),
  q: z.string().trim().max(100).optional(),
});
export type TemplateGalleryQuery = z.infer<typeof templateGalleryQuerySchema>;

export const templateGalleryResponseSchema = z.object({
  categorieList: z.array(templateGalleryCategorySchema),
  pagination: z.object({
    currentPage: z.number().int(),
    perPage: z.number().int(),
    totalPages: z.number().int(),
    totalRecords: z.number().int(),
  }),
  templateList: z.array(templateGalleryItemSchema),
});
export type TemplateGalleryResponse = z.infer<typeof templateGalleryResponseSchema>;
