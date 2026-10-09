'use client';

import { useTranslations } from 'next-intl';
import { API_LIBRARY_LOG_SOURCES } from '@crm/contracts';
import { Button, Field, Input, Select, cn } from '@crm/ui';
import { EMPTY_LOG_FILTERS, hasLogFilters, type LogFilterForm } from '../lib/log-filters';
import { SearchIcon } from './icons';

/** Filters of the runs list. `apis` is set on the full page only (the drawer is already one API). */
export function LogFiltersBar({
  value,
  onChange,
  apis,
}: {
  value: LogFilterForm;
  onChange: (next: LogFilterForm) => void;
  apis?: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations('api-library.logs.filters');
  const tc = useTranslations('api-library.common');
  const set = <K extends keyof LogFilterForm>(k: K, v: LogFilterForm[K]) =>
    onChange({ ...value, [k]: v });
  const chips: Array<{ v: LogFilterForm['status']; label: string }> = [
    { v: '', label: t('allStatus') },
    { v: 'success', label: tc('success') },
    { v: 'failed', label: tc('failed') },
  ];
  return (
    <form
      role="search"
      aria-label={t('label')}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6"
      onSubmit={(e) => e.preventDefault()}
    >
      <Field label={t('search')} htmlFor="alib-log-search" className="sm:col-span-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="alib-log-search"
            type="search"
            className="ps-9"
            value={value.search}
            placeholder={t('searchPlaceholder')}
            maxLength={200}
            onChange={(e) => set('search', e.target.value)}
          />
        </div>
      </Field>
      {apis && (
        <Field label={t('api')} htmlFor="alib-log-api">
          <Select
            id="alib-log-api"
            value={value.apiId}
            onChange={(e) => set('apiId', e.target.value)}
          >
            <option value="">{t('allApis')}</option>
            {apis.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t('source')} htmlFor="alib-log-source">
        <Select
          id="alib-log-source"
          value={value.source}
          onChange={(e) => set('source', e.target.value as LogFilterForm['source'])}
        >
          <option value="">{t('allSources')}</option>
          {API_LIBRARY_LOG_SOURCES.map((s) => (
            <option key={s} value={s}>
              {tc(`source.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('statusCode')} htmlFor="alib-log-code">
        <Input
          id="alib-log-code"
          inputMode="numeric"
          maxLength={3}
          placeholder="200"
          value={value.statusCode}
          onChange={(e) => set('statusCode', e.target.value.replace(/\D/g, ''))}
        />
      </Field>
      <Field label={t('from')} htmlFor="alib-log-from">
        <Input
          id="alib-log-from"
          type="date"
          value={value.from}
          max={value.to || undefined}
          onChange={(e) => set('from', e.target.value)}
        />
      </Field>
      <Field label={t('to')} htmlFor="alib-log-to">
        <Input
          id="alib-log-to"
          type="date"
          value={value.to}
          min={value.from || undefined}
          onChange={(e) => set('to', e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-4 2xl:col-span-6">
        <div className="space-y-1.5">
          <span id="alib-log-result" className="block text-sm font-medium">
            {t('status')}
          </span>
          <div role="group" aria-labelledby="alib-log-result" className="flex gap-1.5">
            {chips.map((c) => (
              <button
                key={c.v || 'all'}
                type="button"
                aria-pressed={value.status === c.v}
                onClick={() => set('status', c.v)}
                className={cn(
                  'h-8 rounded-full border px-3 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
                  value.status === c.v
                    ? 'border-brand bg-brand text-brand-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        {hasLogFilters(value) && (
          <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_LOG_FILTERS)}>
            {t('clear')}
          </Button>
        )}
      </div>
    </form>
  );
}
