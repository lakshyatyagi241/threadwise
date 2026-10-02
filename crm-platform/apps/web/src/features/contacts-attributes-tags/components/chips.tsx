import { cn } from '@crm/ui';
import { avatarTone, initials } from '../lib/contact-model';
import { optionColor } from '../lib/stage-model';
import { CircleDotIcon } from './icons';

const FALLBACK_COLOR = 'var(--primary)';

/** Initials on a pastel circle; the tint is stable per contact (TW-CON-008). */
export function ContactAvatar({
  id,
  name,
  size = 'md',
  className,
}: {
  id: string;
  name: string;
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold',
        size === 'lg' ? 'size-14 text-lg' : 'size-8 text-[11px]',
        avatarTone(id),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Outlined chip with the group's colour dot: groups read as outlines, tags as filled pills, so the two never blur. */
export function GroupChip({ name, color }: { name: string; color?: string | null }) {
  return (
    <span className="inline-flex max-w-[9rem] items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium">
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: color || FALLBACK_COLOR }}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Filled pill in the tag's colour. */
export function TagPill({
  name,
  color,
  onRemove,
  removeLabel,
}: {
  name: string;
  color?: string | null;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const c = color || FALLBACK_COLOR;
  return (
    <span
      className="inline-flex max-w-[9rem] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: `color-mix(in srgb, ${c} 12%, transparent)`,
        color: c,
        borderColor: `color-mix(in srgb, ${c} 30%, transparent)`,
      }}
    >
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-me-0.5 rounded-full px-0.5 leading-none hover:opacity-70"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      )}
    </span>
  );
}

/** "Order Id: A12" style custom-value chip with the full text on hover. */
export function AttributeChip({
  label,
  text,
  full,
}: {
  label: string;
  text: string;
  full: string;
}) {
  return (
    <span
      title={full}
      className="inline-flex max-w-[8.5rem] items-center truncate rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground"
    >
      <span className="font-semibold">{label}:</span>&nbsp;{text}
    </span>
  );
}

/** Small outlined pill for table cells: the tag's colour only on the outline, the text stays readable in any theme. */
export function TagChip({ name, color }: { name: string; color?: string | null }) {
  const c = color || FALLBACK_COLOR;
  return (
    <span
      title={name}
      className="inline-flex max-w-[8.5rem] items-center rounded-full border px-2.5 py-0.5 text-xs text-foreground"
      style={{ borderColor: `color-mix(in srgb, ${c} 55%, var(--border))` }}
    >
      <span className="truncate">{name}</span>
    </span>
  );
}

/** "+3" after the chips that fit; the full list is in the tooltip. */
export function MoreChip({ count, title }: { count: number; title: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
    >
      +{count}
    </span>
  );
}

/** Stage as a soft filled badge with a dot icon, in the stage's colour. */
export function StageBadge({
  stage,
  label,
  color,
}: {
  stage: string;
  label: string;
  /** The workspace's colour for this stage; the stable fallback for the value when absent. */
  color?: string | null;
}) {
  const c = optionColor({ value: stage, color });
  return (
    <span
      title={label}
      className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{
        background: `color-mix(in srgb, ${c} 12%, transparent)`,
        color: `color-mix(in srgb, ${c} 80%, var(--foreground))`,
        borderColor: `color-mix(in srgb, ${c} 28%, transparent)`,
      }}
    >
      <CircleDotIcon className="size-3" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Plain outlined tag for a short categorical value (language). */
export function OutlineTag({ value }: { value: string }) {
  return (
    <span
      title={value}
      className="inline-flex max-w-full items-center rounded-md border border-border px-2 py-0.5 text-xs text-foreground"
    >
      <span className="truncate">{value}</span>
    </span>
  );
}
