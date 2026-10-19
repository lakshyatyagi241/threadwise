'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, type ChangeEvent } from 'react';
import { Button, Input, cn } from '@crm/ui';
import { isHexColour } from '@/lib/brand-kit/colour';

/**
 * A colour: the browser's picker and a text box that stay in step, plus "clear" (the colour is then inherited). Only `#RRGGBB` is
 * accepted; what is typed is shown as typed until it is a colour, so a half-typed value is never rewritten under the cursor.
 */
export function ColourField({
  label,
  value,
  fallback,
  hint,
  error,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  /** Shown in the swatch and as the placeholder while the field is empty: the colour it inherits. */
  fallback: string | null;
  hint?: string;
  error?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('appointments.appearance.fields');
  const id = useId();
  const shown = isHexColour(value) ? value : (fallback ?? '#000000');
  return (
    <div className="space-y-1.5 text-sm">
      <label htmlFor={`${id}-text`} className="block font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={t('picker', { name: label })}
          value={shown}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-background p-1 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Input
          id={`${id}-text`}
          dir="ltr"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={7}
          value={value}
          placeholder={fallback ?? '#RRGGBB'}
          disabled={disabled}
          invalid={Boolean(error)}
          aria-describedby={error || hint ? `${id}-note` : undefined}
          onChange={(e) => onChange(e.target.value.trim())}
          className="font-mono"
        />
        {value !== '' && !disabled && (
          <Button type="button" variant="secondary" size="sm" onClick={() => onChange('')}>
            {t('clear')}
          </Button>
        )}
      </div>
      {error ? (
        <p id={`${id}-note`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-note`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A picture slot: what it shows now, "Upload" / "Replace" and "Remove". Choosing a file only stages it (the editor uploads it with the
 * rest on save); the preview shows it at once.
 */
export function PictureField({
  label,
  hint,
  src,
  inherited,
  error,
  disabled,
  onPick,
  onRemove,
  canRemove,
  shape,
}: {
  label: string;
  hint: string;
  /** What is shown now (the saved or the staged picture), or null. */
  src: string | null;
  /** True when `src` comes from a level above (nothing of its own yet). */
  inherited: boolean;
  error?: string;
  disabled?: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
  canRemove: boolean;
  shape: 'logo' | 'cover';
}) {
  const t = useTranslations('appointments.appearance.fields');
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const change = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onPick(file);
  };
  return (
    <div className="space-y-1.5 text-sm">
      <span id={`${id}-label`} className="block font-medium">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <div
          className={cn(
            'flex items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted',
            shape === 'logo' ? 'h-16 w-28' : 'h-16 w-40',
          )}
        >
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="px-2 text-center text-xs text-muted-foreground">{t('noPicture')}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            id={id}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            tabIndex={-1}
            aria-labelledby={`${id}-label`}
            disabled={disabled}
            onChange={change}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            {src && !inherited ? t('replace') : t('upload')}
          </Button>
          {canRemove && !disabled && (
            <Button type="button" variant="secondary" size="sm" onClick={onRemove}>
              {t('remove')}
            </Button>
          )}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {inherited && src ? `${t('inheritedPicture')} ` : ''}
          {hint}
        </p>
      )}
    </div>
  );
}

/** A small set of exclusive choices drawn as buttons (corners, colour mode, background). */
export function ChoiceGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ id: T; label: string }>;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5 text-sm">
      <span className="block font-medium">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            disabled={disabled}
            onClick={() => onChange(o.id)}
            className={cn(
              'min-h-10 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50',
              value === o.id
                ? 'border-brand bg-brand/10 font-semibold text-primary'
                : 'border-border hover:bg-muted',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
