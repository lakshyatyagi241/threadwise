'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { cn } from '@crm/ui';
import { capitalise, groupPermissions, setMany, toggleOne, triState } from '../lib/matrix';
import { PersonIcon } from './icons';
import { SectionBadge } from './chrome';
import { TriCheckbox } from './tri-checkbox';

const NS = 'roles-permissions.matrix';
const NONE: ReadonlySet<string> = new Set();

/**
 * Section 02 of both role editors: the grouped permission matrix. Every name of the catalogue is a checkbox, grouped by
 * module; each module has a tri-state "Select all", the header has a tri-state "Select all permissions" and a live
 * "n / total selected" counter, like Reference's roles-create.js / roles-edit.js.
 */
export function PermissionMatrix({
  catalogue,
  selected,
  onChange,
  lockedNames,
  canCreatePermission,
}: {
  catalogue: ReadonlyArray<{ name: string; module: string }>;
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** A locked role's grants: ticked and not changeable. Other boxes can still be ticked. */
  lockedNames?: ReadonlySet<string>;
  /** Whether the empty state may link to "Create one". */
  canCreatePermission?: boolean;
}) {
  const t = useTranslations(NS);
  const groups = useMemo(() => groupPermissions(catalogue), [catalogue]);
  const allNames = useMemo(() => catalogue.map((p) => p.name), [catalogue]);
  const keep = lockedNames ?? NONE;
  const allLocked = (names: readonly string[]) =>
    names.length > 0 && names.every((n) => keep.has(n));
  const count = allNames.filter((n) => selected.has(n)).length;
  const grand = triState(selected, allNames);

  return (
    <section
      aria-labelledby="matrix-title"
      className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <SectionBadge n="02" />
          <h2 id="matrix-title" className="text-lg font-semibold leading-none">
            {t('title')}
          </h2>
          <span
            aria-live="polite"
            dir="auto"
            data-testid="perm-count"
            className="font-mono text-xs text-muted-foreground"
          >
            {t('counter', { count, total: allNames.length })}
          </span>
        </div>
        <TriCheckbox
          state={grand}
          disabled={allNames.length === 0 || allLocked(allNames)}
          onChange={(on) => onChange(setMany(selected, allNames, on, keep))}
          label={<span className="text-sm font-semibold">{t('selectAll')}</span>}
          data-testid="grand-select"
          className="hover:text-primary"
        />
      </div>

      {groups.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          {canCreatePermission
            ? t.rich('empty', {
                link: (chunks) => (
                  <Link
                    href="/admin/permissions/new"
                    className="font-semibold text-primary hover:underline"
                  >
                    {chunks}
                  </Link>
                ),
              })
            : t('emptyPlain')}
        </p>
      ) : (
        <div>
          <div
            aria-hidden="true"
            className="hidden border-b border-border bg-muted px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground md:grid md:grid-cols-[11rem_9rem_1fr] md:gap-3"
          >
            <span>{t('module')}</span>
            <span>{t('selectAllColumn')}</span>
            <span>{t('available')}</span>
          </div>
          <div className="divide-y divide-border">
            {groups.map((g) => {
              const state = triState(selected, g.names);
              const headingId = `matrix-module-${g.module}`;
              return (
                <div
                  key={g.module}
                  role="group"
                  aria-labelledby={headingId}
                  data-module={g.module}
                  className="grid gap-x-3 gap-y-3 px-4 py-3 hover:bg-muted/40 md:grid-cols-[11rem_9rem_1fr]"
                >
                  <div className="flex items-start gap-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <PersonIcon />
                    </span>
                    <span id={headingId} className="pt-1 text-sm font-semibold">
                      {capitalise(g.module)}
                    </span>
                  </div>
                  <div className="pt-0.5">
                    <TriCheckbox
                      state={state}
                      disabled={allLocked(g.names)}
                      onChange={(on) => onChange(setMany(selected, g.names, on, keep))}
                      label={<span className="text-xs">{t('selectAllModule')}</span>}
                      aria-label={t('selectAllOf', { module: capitalise(g.module) })}
                      data-testid={`select-all-${g.module}`}
                    />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-0.5">
                    {g.names.map((name) => (
                      <label
                        key={name}
                        className={cn(
                          'inline-flex items-center gap-2 break-all text-xs',
                          keep.has(name) ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
                        )}
                      >
                        <input
                          type="checkbox"
                          name="permissions"
                          value={name}
                          checked={selected.has(name)}
                          disabled={keep.has(name)}
                          onChange={() => onChange(toggleOne(selected, name))}
                          className="size-4 shrink-0 rounded border-border accent-[var(--primary)]"
                        />
                        {name}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
