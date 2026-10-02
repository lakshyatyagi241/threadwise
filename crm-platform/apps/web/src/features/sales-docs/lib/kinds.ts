/**
 * Proposals and estimates are one engine (WD-PROP / WD-EST): the same table, the same screens, the same public page. The
 * "kind" only changes the label, the number prefix and the route.
 */
export const KINDS = ['proposal', 'estimate'] as const;
export type SalesDocKind = (typeof KINDS)[number];

export interface KindMeta {
  /** Number prefix the server allocates (`PRO-0001`, `EST-0001`); shown in placeholders only. */
  prefix: string;
  /** The list route; the builder lives at `<base>/new` and `<base>/<id>`. */
  base: string;
}

export const KIND_META: Record<SalesDocKind, KindMeta> = {
  proposal: { prefix: 'PRO', base: '/proposals' },
  estimate: { prefix: 'EST', base: '/estimates' },
};

export const isKind = (v: unknown): v is SalesDocKind => v === 'proposal' || v === 'estimate';

/** `/proposals/new?contact=..` and friends: where a new document of a kind starts. */
export function newDocHref(kind: SalesDocKind, link?: { contact?: string; deal?: string }): string {
  const p = new URLSearchParams();
  if (link?.contact) p.set('contact', link.contact);
  if (link?.deal) p.set('deal', link.deal);
  const s = p.toString();
  return `${KIND_META[kind].base}/new${s ? `?${s}` : ''}`;
}

export const docHref = (kind: SalesDocKind, id: string): string => `${KIND_META[kind].base}/${id}`;
