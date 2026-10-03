'use client';

import { Select, cn } from '@crm/ui';
import { FB_BLUE, FacebookGlyph } from './fb-icons';

export interface PageOption {
  id: string;
  pageId: string;
  name: string | null;
}

export const pageLabel = (p: PageOption): string => p.name || p.pageId;

/** The Page picker the Facebook screens share: a Facebook-blue chip, the Page names, and an optional "all" entry. */
export function PageSelect({
  pages,
  value,
  onChange,
  label,
  allLabel,
  className,
}: {
  pages: readonly PageOption[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** When set, the first option is "all Pages" with the empty value. */
  allLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <span
        className="pointer-events-none absolute left-2.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-white"
        style={{ background: FB_BLUE }}
        aria-hidden
      >
        <FacebookGlyph className="size-3" />
      </span>
      <Select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-full pl-9 text-[13px] font-semibold"
      >
        {allLabel !== undefined && <option value="">{allLabel}</option>}
        {pages.map((p) => (
          <option key={p.id} value={p.id}>
            {pageLabel(p)}
          </option>
        ))}
      </Select>
    </div>
  );
}
