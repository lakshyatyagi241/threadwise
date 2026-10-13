import { str, type Doc } from '../util';

/**
 * Which wa_templates row a Waboo campaign (`broadcasting` document) sent. Shared by the loader (transform/broadcast.ts) and the repair
 * command `campaign-link` (load/campaignlink.ts); the verifier has its own copy (reconcile/oracle-campaigns.ts).
 *
 * What the campaign carries (structure seen on iskm / rhythm): `broadcast_template_id` (the Waboo `id` of a broadcast_templates
 * document: 100% of the campaigns, every one equal to the `id` its recipients carry), `broadcast_template_name`, `_type`, `_category`.
 * It carries NO language and NO Meta id; the Meta id is on the recipients (`whatsapp_broadcasting_data.meta_template_id`, one value per
 * campaign, equal to the template's own meta_template_id on every campaign checked).
 *
 * EXACT rules, in this order. Anything else is NULL and a counted soft issue; nothing is ever guessed:
 *   1. reference: `broadcast_template_id` is a key of a migrated template (migration.id_map, collection broadcast_templates). When the
 *      campaign also names the template (`broadcast_template_name`) the name must be identical, else CONFLICT.
 *   2. meta id: the campaign's own `meta_template_id`, else the ONE distinct `meta_template_id` of its loaded recipients (two or more
 *      distinct values count as no meta id), matched to wa_templates.meta_template_id. One row = a link; several rows = AMBIGUOUS.
 *      When 1 and 2 both find a row they must be the same row, else CONFLICT.
 *   3. name (+ language when the campaign carries one): only when 1 and 2 found nothing AND no meta id is known (a known meta id that
 *      matches no template says the sent template is not among the loaded ones; a same-named template would be another one). Exactly
 *      one row = a link; several (other languages) = AMBIGUOUS.
 */
export interface TemplateRow {
  id: number;
  name: string;
  language: string;
  metaId: string | null;
}

export interface TemplateIndex {
  /** Waboo template key (ObjectId hex and string id) -> row */
  byKey: Map<string, TemplateRow>;
  byMeta: Map<string, TemplateRow[]>;
  byName: Map<string, TemplateRow[]>;
}

export const emptyTemplates = (): TemplateIndex => ({
  byKey: new Map(),
  byMeta: new Map(),
  byName: new Map(),
});

/** `keys`: Waboo key -> wa_templates.id (from migration.id_map). A key whose row is not in `rows` is ignored. */
export function indexTemplates(rows: TemplateRow[], keys: Array<[string, number]>): TemplateIndex {
  const idx = emptyTemplates();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const push = (m: Map<string, TemplateRow[]>, k: string, r: TemplateRow): void => {
    m.set(k, [...(m.get(k) ?? []), r]);
  };
  for (const r of rows) {
    if (r.metaId) push(idx.byMeta, r.metaId, r);
    push(idx.byName, r.name, r);
  }
  for (const [k, id] of keys) {
    const r = byId.get(id);
    if (r) idx.byKey.set(k, r);
  }
  return idx;
}

export type LinkHow = 'reference' | 'meta' | 'name';
export type UnlinkedWhy = 'NO_REFERENCE' | 'NOT_FOUND' | 'AMBIGUOUS' | 'CONFLICT';
export interface Link {
  id: number | null;
  how: LinkHow | null;
  why: UnlinkedWhy | null;
}

const no = (why: UnlinkedWhy): Link => ({ id: null, how: null, why });

/** The Meta id of a campaign: its own, else the single value its recipients agree on. */
export function metaIdOf(doc: Doc, recipientMeta: ReadonlySet<string> | undefined): string | null {
  const own = str(doc.meta_template_id);
  if (own) return own;
  return recipientMeta && recipientMeta.size === 1 ? [...recipientMeta][0]! : null;
}

export function linkTemplate(
  doc: Doc,
  idx: TemplateIndex,
  recipientMeta: ReadonlySet<string> | undefined,
): Link {
  const ref = str(doc.broadcast_template_id);
  const name = str(doc.broadcast_template_name);
  const language = str(doc.language) ?? str(doc.broadcast_template_language);
  const meta = metaIdOf(doc, recipientMeta);

  const byRef = ref ? idx.byKey.get(ref) : undefined;
  if (byRef && name && byRef.name !== name) return no('CONFLICT');
  const metaRows = meta ? (idx.byMeta.get(meta) ?? []) : [];
  const byMeta = metaRows.length === 1 ? metaRows[0] : undefined;
  if (byRef && byMeta && byRef.id !== byMeta.id) return no('CONFLICT');
  if (byRef && metaRows.length > 1 && !metaRows.some((r) => r.id === byRef.id)) return no('CONFLICT');
  if (byRef) return { id: byRef.id, how: 'reference', why: null };
  if (byMeta) return { id: byMeta.id, how: 'meta', why: null };
  if (metaRows.length > 1) return no('AMBIGUOUS');
  if (meta) return no('NOT_FOUND');
  if (!name) return no(ref ? 'NOT_FOUND' : 'NO_REFERENCE');
  const named = (idx.byName.get(name) ?? []).filter((r) => !language || r.language === language);
  if (named.length === 1) return { id: named[0]!.id, how: 'name', why: null };
  return no(named.length > 1 ? 'AMBIGUOUS' : 'NOT_FOUND');
}
