import type { HelpBlock, HelpInline } from './types';

/** The longest text a tooltip shows from a doc. */
const TIP_MAX = 240;

export function plainText(inline: readonly HelpInline[]): string {
  return inline.map((run) => run.v).join('');
}

const clip = (text: string): string =>
  text.length > TIP_MAX ? `${text.slice(0, TIP_MAX - 1).trimEnd()}…` : text;

/**
 * The text a tooltip shows: the first paragraph of the doc, or, with `anchor`, the first paragraph under that heading (stopping at
 * the next heading of the same or a higher level). Null when there is none, so a tip never opens empty.
 */
export function leadParagraph(blocks: readonly HelpBlock[], anchor?: string): string | null {
  let from = 0;
  let level = 0;
  if (anchor !== undefined) {
    const at = blocks.findIndex((b) => b.t === 'h' && b.id === anchor);
    const heading = blocks[at];
    if (!heading || heading.t !== 'h') return null;
    from = at + 1;
    level = heading.level;
  }
  for (const block of blocks.slice(from)) {
    if (block.t === 'h' && block.level <= level) return null;
    if (block.t === 'p') {
      const text = plainText(block.inline).trim();
      return text === '' ? null : clip(text);
    }
  }
  return null;
}

/** A link to a doc the person cannot see becomes plain text, so a hidden doc is never revealed by a neighbour. */
export function degradeDocLinks(
  blocks: readonly HelpBlock[],
  visibleIds: ReadonlySet<string>,
): HelpBlock[] {
  const runs = (inline: readonly HelpInline[]): HelpInline[] =>
    inline.map((run) =>
      run.t === 'doc' && !visibleIds.has(run.doc) ? { t: 'text', v: run.v } : run,
    );
  return blocks.map((block): HelpBlock => {
    switch (block.t) {
      case 'p':
      case 'note':
        return { ...block, inline: runs(block.inline) };
      case 'ul':
      case 'ol':
        return { ...block, items: block.items.map(runs) };
      default:
        return block;
    }
  });
}
