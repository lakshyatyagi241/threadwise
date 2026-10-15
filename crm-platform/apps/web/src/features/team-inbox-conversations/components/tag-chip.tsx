import type { ConversationTag } from '@crm/contracts';
import { cn } from '@crm/ui';

/** Reference's neutral default for a tag with no (or an unusable) colour. */
export const DEFAULT_TAG_COLOR = '#075E54';

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const BARE_HEX = /^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const NAMED = /^[a-zA-Z]{3,20}$/;

/**
 * A tag colour that is safe to put in a style: a hex colour (with or without the `#`) or a plain colour name. Anything else (a
 * function, a url, a semicolon) falls back to the default, so a stored value can never inject CSS.
 */
export function safeTagColor(raw: string | null | undefined): string {
  const c = (raw ?? '').trim();
  if (HEX.test(c)) return c;
  if (BARE_HEX.test(c)) return `#${c}`;
  if (NAMED.test(c)) return c;
  return DEFAULT_TAG_COLOR;
}

export function TagChip({
  tag,
  className,
}: {
  tag: Pick<ConversationTag, 'name' | 'color'>;
  className?: string;
}) {
  const color = safeTagColor(tag.color);
  return (
    <span
      data-testid="inbox-tag-chip"
      dir="auto"
      className={cn(
        'inline-flex max-w-[9rem] items-center gap-1 truncate rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="truncate">{tag.name}</span>
    </span>
  );
}
