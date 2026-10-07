'use client';

import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { WIZARD_TEMPLATE_CATEGORIES, type WizardTemplate } from '@crm/contracts';
import { EmptyState, Input, Select } from '@crm/ui';
import {
  NO_FILTERS,
  filterTemplates,
  isFiltered,
  languageOptions,
  snippet,
  type TemplateCategory,
  type TemplateFilters,
} from '../lib/templates';
import { ChoiceCard, Chip, ErrorBlock, Skeleton } from './parts';

export interface TemplatesQuery {
  data?: { data: WizardTemplate[] };
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/** The approved templates as selectable cards, with a search box and language and category filters. */
export function TemplatePicker({
  templates,
  selectedId,
  onSelect,
  invalid,
  initialFilters = NO_FILTERS,
}: {
  templates: TemplatesQuery;
  selectedId: string | null;
  onSelect: (t: WizardTemplate) => void;
  invalid?: boolean;
  /** Where the filters start (the screens leave it empty). */
  initialFilters?: TemplateFilters;
}) {
  const t = useTranslations('campaigns.wizard.template');
  const tc = useTranslations('campaigns.wizard.categories');
  const [filters, setFilters] = useState<TemplateFilters>(initialFilters);
  const uid = useId();
  const list = templates.data?.data;
  const shown = useMemo(() => (list ? filterTemplates(list, filters) : []), [list, filters]);
  const languages = useMemo(() => (list ? languageOptions(list) : []), [list]);

  if (templates.isPending) return <Skeleton label={t('loading')} lines={5} />;
  if (templates.isError) {
    return <ErrorBlock error={templates.error} onRetry={() => void templates.refetch()} />;
  }
  if (!list || list.length === 0) {
    return (
      <EmptyState
        title={t('emptyTitle')}
        message={t('emptyHint')}
        actions={
          <Link
            href="/templates"
            className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:opacity-90"
          >
            {t('createTemplate')}
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <Input
          type="search"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          placeholder={t('search')}
          aria-label={t('search')}
        />
        <Select
          value={filters.language}
          onChange={(e) => setFilters({ ...filters, language: e.target.value })}
          aria-label={t('filterLanguage')}
          className="sm:w-44"
        >
          <option value="">{t('allLanguages')}</option>
          {languages.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
        <Select
          value={filters.category}
          onChange={(e) =>
            setFilters({ ...filters, category: e.target.value as TemplateCategory | '' })
          }
          aria-label={t('filterCategory')}
          className="sm:w-44"
        >
          <option value="">{t('allCategories')}</option>
          {WIZARD_TEMPLATE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {tc(c)}
            </option>
          ))}
        </Select>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={t('noMatchTitle')}
          message={t('noMatchHint')}
          actions={
            isFiltered(filters) && (
              <button
                type="button"
                className="text-sm font-medium text-brand underline underline-offset-2"
                onClick={() => setFilters(NO_FILTERS)}
              >
                {t('clearFilters')}
              </button>
            )
          }
        />
      ) : (
        <div
          role="radiogroup"
          aria-label={t('listLabel')}
          aria-invalid={invalid || undefined}
          className="grid gap-2"
        >
          {shown.map((tpl) => (
            <ChoiceCard
              key={tpl.id}
              type="radio"
              name={`tpl-${uid}`}
              checked={tpl.id === selectedId}
              onChange={() => onSelect(tpl)}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-semibold">{tpl.name}</span>
                <Chip>{tpl.language}</Chip>
                <Chip tone="brand">{tc(tpl.category)}</Chip>
              </span>
              <span className="mt-1 block text-muted-foreground">{snippet(tpl.body)}</span>
              {tpl.senderLabel && (
                <span className="mt-1.5 block text-xs text-muted-foreground">
                  {t('sentFrom', { sender: tpl.senderLabel })}
                </span>
              )}
            </ChoiceCard>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {t('count', { shown: shown.length, total: list.length })}
      </p>
    </div>
  );
}
