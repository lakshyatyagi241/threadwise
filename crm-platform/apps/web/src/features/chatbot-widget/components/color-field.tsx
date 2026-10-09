'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { swatchValue } from '../lib/builder-model';

/**
 * A colour as WaDesk's builder shows it: the native swatch and a hex text box bound to the same value, so either one edits
 * it and the other follows. The text box carries the id (it is the one that is flashed and focused on a problem).
 */
export function ColorField({
  id,
  value,
  onChange,
  label,
  invalid,
  className,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
  invalid?: boolean;
  className?: string;
}) {
  const t = useTranslations('chatbotWidget.builder');
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <input
        type="color"
        aria-label={t('colorSwatch', { label })}
        value={swatchValue(value)}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="size-10 shrink-0 cursor-pointer rounded-md border border-border bg-muted p-0.5"
      />
      <input
        id={id}
        type="text"
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={value}
        maxLength={16}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 font-mono text-[12.5px] outline-none',
          'focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/10',
          invalid ? 'border-danger ring-2 ring-danger/40' : 'border-border',
        )}
      />
    </div>
  );
}
