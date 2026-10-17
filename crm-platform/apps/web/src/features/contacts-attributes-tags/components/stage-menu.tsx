'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { titleCaseKey } from '../lib/contact-model';
import type { Choice } from '../lib/option-sets';
import { optionColor } from '../lib/stage-model';
import { StageBadge } from './chips';
import { CheckIcon, ChevronDownIcon } from './icons';
import { RowMenu, RowMenuItem } from './row-menu';

/**
 * A contact's lifecycle stage as a badge that opens a menu of the workspace's stages (the table's stage cell and the
 * detail page header). Picking one calls `onChange`; the caller saves it. Without `onChange` it is a plain badge.
 */
export function StageMenu({
  value,
  choices,
  name,
  label: labelOverride,
  busy,
  onChange,
  statusHint,
  quietCaret,
}: {
  value: string;
  choices: readonly Choice[];
  /** The contact's name, for the button's accessible label. */
  name: string;
  /** Text of the badge when the caller already resolved it. */
  label?: string;
  busy?: boolean;
  onChange?: (value: string) => void;
  /** What moving to a stage does to the contact's status ("Status becomes X"), shown under that stage; null = nothing. */
  statusHint?: (stage: string) => string | null;
  /** Draw the caret only while the row is hovered or has focus (inside a `group`), so a long list is not a column of carets. */
  quietCaret?: boolean;
}) {
  const t = useTranslations('contacts-attributes-tags.stageMenu');
  const current = choices.find((c) => c.value === value);
  const label = labelOverride ?? current?.label ?? titleCaseKey(value);
  const badge = <StageBadge stage={value} label={label} color={current?.color} />;
  if (!onChange) return badge;
  return (
    <RowMenu
      label={t('change', { name })}
      width={232}
      className={cn(busy && 'pointer-events-none opacity-60')}
      trigger={
        <span className="inline-flex min-w-0 items-center gap-0.5">
          {badge}
          <ChevronDownIcon
            className={cn(
              'size-3 shrink-0 text-muted-foreground',
              quietCaret &&
                'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100',
            )}
          />
        </span>
      }
    >
      {(close) => (
        <>
          <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('moveTo')}
          </div>
          {choices.map((c) => (
            <RowMenuItem
              key={c.value}
              onSelect={() => {
                close();
                if (c.value !== value) onChange(c.value);
              }}
            >
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: optionColor({ value: c.value, color: c.color }) }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{c.label}</span>
                {c.value !== value && statusHint?.(c.value) && (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {statusHint(c.value)}
                  </span>
                )}
              </span>
              {c.value === value && <CheckIcon className="size-3.5 text-primary" />}
            </RowMenuItem>
          ))}
        </>
      )}
    </RowMenu>
  );
}
