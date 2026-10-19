import type { WechatBroadcast } from '@crm/contracts';

/** What the broadcasts list decides without the network. Pure. */

export type RowAction = 'send' | 'retry' | null;

/**
 * The button on a row. A draft is sent; a failed one (or one stuck sending after its worker died) is sent again. Sent and still-sending
 * broadcasts have none: a mass send cannot be repeated or taken back.
 */
export function rowAction(b: Pick<WechatBroadcast, 'status' | 'canRetry'>): RowAction {
  if (b.status === 'draft') return 'send';
  if (b.canRetry) return 'retry';
  return null;
}

/** Which audience wording a row shows: all followers, a tag with its number, or the number of picked people. */
export function audienceLabel(b: Pick<WechatBroadcast, 'audience' | 'tagId' | 'total'>): {
  key: 'all' | 'tag' | 'list';
  values: { tag: string; count: number };
} {
  return { key: b.audience, values: { tag: b.tagId ?? '', count: b.total } };
}
