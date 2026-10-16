import { describe, expect, it } from 'vitest';
import {
  templateGalleryResponseSchema,
  TEMPLATE_GALLERY_CATEGORIES,
  tplButtonSchema,
} from '@crm/contracts';
import { galleryOf } from '../../src/modules/message-templates/gallery';
import { GALLERY_TEMPLATES } from '../../src/modules/message-templates/gallery.data';

describe('template gallery', () => {
  it('answers in the shape the screen reads, with every category and all the templates', () => {
    const r = galleryOf({});
    expect(templateGalleryResponseSchema.safeParse(r).success).toBe(true);
    expect(r.categorieList.map((c) => c.id)).toEqual([...TEMPLATE_GALLERY_CATEGORIES]);
    expect(r.pagination).toEqual({
      currentPage: 0,
      perPage: 10000,
      totalPages: 1,
      totalRecords: 17,
    });
    expect(r.templateList).toHaveLength(17);
  });

  it('every template has a unique id, a body whose samples match its variables, and valid buttons', () => {
    const ids = GALLERY_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of GALLERY_TEMPLATES) {
      expect(t.id).toMatch(/^[a-z0-9_]+$/);
      const bodyC = t.components.find((c) => c.type === 'BODY');
      expect(bodyC?.text, t.id).toBeTruthy();
      const vars = new Set([...bodyC!.text!.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]));
      const samples = ((bodyC!.example as { body_text?: string[][] } | undefined)?.body_text?.[0] ??
        []) as string[];
      expect(samples.length, t.id).toBe(vars.size);
      // Meta refuses a body that starts or ends with a variable.
      expect(bodyC!.text!.trim(), t.id).not.toMatch(/^\{\{\d+\}\}|\{\{\d+\}\}$/);
      for (const c of t.components)
        for (const b of c.buttons ?? [])
          expect(tplButtonSchema.safeParse(b).success, t.id).toBe(true);
      expect(t.button_type === 'none', t.id).toBe(!t.components.some((c) => c.type === 'BUTTONS'));
    }
  });

  it('filters by category and by a word of the name or the text', () => {
    expect(
      galleryOf({ category: 'education' })
        .templateList.map((t) => t.id)
        .sort(),
    ).toEqual(['admission_inquiry', 'tuition_fees_reminder', 'upcoming_exam_reminder']);
    expect(
      galleryOf({ q: 'diwali' })
        .templateList.map((t) => t.id)
        .sort(),
    ).toEqual(['festive_loan_offer', 'we_are_closed']);
    // A search also reads button labels and the category name.
    expect(galleryOf({ q: 'food delivery' }).templateList.length).toBe(2);
    const none = galleryOf({ q: 'zzzz-nothing' });
    expect(none.templateList).toEqual([]);
    expect(none.pagination.totalRecords).toBe(0);
    expect(none.categorieList).toHaveLength(6);
  });

  it('ships no brand names, real-looking numbers or hosted pictures', () => {
    const all = JSON.stringify(GALLERY_TEMPLATES).toLowerCase();
    for (const bad of ['geta', 'wabo', '+91', 'assets.', 'header_handle'])
      expect(all).not.toContain(bad);
  });
});
