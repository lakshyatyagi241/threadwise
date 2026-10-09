'use client';

import type { ReactNode } from 'react';
import { cn } from '@crm/ui';
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;
const base = (p: IconProps) => ({
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

export const BubbleIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H8l-3 2v-2a2 2 0 0 1-2-2z" />
  </svg>
);
export const TemplateIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.5" y="3" width="11" height="10" rx="2" />
    <path d="M5 6.5h6M5 9.5h4" />
  </svg>
);
export const FlowIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="4" cy="4" r="1.6" />
    <circle cx="12" cy="8" r="1.6" />
    <circle cx="4" cy="12" r="1.6" />
    <path d="M5.4 4.8l5.2 2.4M5.4 11.2l5.2-2.4" />
  </svg>
);
export const SparkIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.7}>
    <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4.2 4.2l2.1 2.1M9.7 9.7l2.1 2.1M11.8 4.2L9.7 6.3M6.3 9.7l-2.1 2.1" />
  </svg>
);
export const TickIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

/** One numbered card of a step: the mono index, a serif title and a small tag on the right (WaDesk's section frame). */
export function StepCard({
  index,
  title,
  tag,
  children,
}: {
  index: string;
  title: string;
  tag?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="inline-flex size-[23px] shrink-0 items-center justify-center rounded-[7px] bg-muted font-mono text-[10px] font-semibold text-brand">
          {index}
        </span>
        <h2 className="flex-1 text-lg leading-none">{title}</h2>
        {tag && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {tag}
          </span>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** A large selectable card: an icon, a title, a line of help, and a tick when chosen. */
export function ChoiceCard({
  checked,
  onSelect,
  icon,
  title,
  hint,
  compact,
  disabled,
}: {
  checked: boolean;
  onSelect: () => void;
  /** Shown but not selectable (the reason is said next to the group). */
  disabled?: boolean;
  icon?: ReactNode;
  title: string;
  hint: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onSelect();
      }}
      className={cn(
        'relative rounded-2xl border text-start transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
        compact ? 'px-3.5 py-3' : 'p-4',
        checked ? 'border-brand bg-brand/5' : 'border-border',
      )}
    >
      {icon && (
        <span
          className={cn(
            'grid size-10 place-items-center rounded-xl',
            checked ? 'bg-brand/15 text-brand' : 'bg-muted text-brand',
          )}
        >
          {icon}
        </span>
      )}
      <span
        className={cn(
          'absolute end-3 top-3 grid size-5 place-items-center rounded-full bg-brand text-background transition',
          checked ? 'opacity-100' : 'opacity-0',
        )}
      >
        <TickIcon className="size-3" />
      </span>
      <span className={cn('block text-[15px] font-semibold', icon ? 'mt-3' : null)}>{title}</span>
      <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{hint}</span>
    </button>
  );
}

/** A label with an optional "optional / max 60" note on the right. */
export function LabelRow({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2 text-[11.5px] font-semibold">
      <span>{children}</span>
      {note && (
        <span className="font-mono text-[10px] font-normal text-muted-foreground">{note}</span>
      )}
    </div>
  );
}
