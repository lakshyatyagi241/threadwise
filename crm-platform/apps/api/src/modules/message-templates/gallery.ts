import type { TemplateGalleryQuery, TemplateGalleryResponse } from '@crm/contracts';
import { TEMPLATE_GALLERY_CATEGORIES } from '@crm/contracts';
import { GALLERY_CATEGORY_NAMES, GALLERY_TEMPLATES } from './gallery.data';

/**
 * The gallery answer: every category (always, so the tabs and columns do not move), and the templates of the chosen category whose
 * name or text contains the search. One page holds them all (the gallery is a few dozen templates).
 */
/** What a search looks in, built once: name, category, every text and every button label of a template, lower case. */
const HAYSTACK = new Map(
  GALLERY_TEMPLATES.map((t) => [
    t.id,
    [
      t.name,
      GALLERY_CATEGORY_NAMES[t.category],
      ...t.components.flatMap((c) => [c.text ?? '', ...(c.buttons ?? []).map((x) => x.text ?? '')]),
    ]
      .join(' ')
      .toLowerCase(),
  ]),
);

export function galleryOf(query: TemplateGalleryQuery): TemplateGalleryResponse {
  const needle = (query.q ?? '').trim().toLowerCase();
  const templateList = GALLERY_TEMPLATES.filter(
    (t) =>
      (!query.category || t.category === query.category) &&
      (needle === '' || HAYSTACK.get(t.id)!.includes(needle)),
  );
  return {
    categorieList: TEMPLATE_GALLERY_CATEGORIES.map((id) => ({
      id,
      name: GALLERY_CATEGORY_NAMES[id],
    })),
    pagination: {
      currentPage: 0,
      perPage: 10000,
      totalPages: 1,
      totalRecords: templateList.length,
    },
    templateList: [...templateList],
  };
}
