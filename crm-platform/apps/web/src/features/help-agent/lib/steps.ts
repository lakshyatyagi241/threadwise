import { plainText } from '@/features/help-center/blocks';
import type { HelpBlock, HelpInline } from '@/features/help-center/types';

const MAX_STEPS = 8;
const MAX_CHARS = 220;

/**
 * The how-to steps of a guide, for the assistant's answer: the items of its first numbered list (the guides write their procedure as
 * one), else of its first bullet list. Plain text, bounded; empty when the guide has no list.
 */
export function guideSteps(blocks: readonly HelpBlock[]): string[] {
  const lists = blocks.filter(
    (b): b is { t: 'ul' | 'ol'; items: HelpInline[][] } => b.t === 'ul' || b.t === 'ol',
  );
  const list = lists.find((b) => b.t === 'ol') ?? lists[0];
  if (!list) return [];
  return list.items
    .map((item) => plainText(item).trim())
    .filter((text) => text !== '')
    .slice(0, MAX_STEPS)
    .map((text) => (text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1).trimEnd()}…` : text));
}
