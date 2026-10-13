'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { AUDIT_ACTOR_KINDS, type AuditLogFacets } from '@crm/contracts';
import { Button, Checkbox, Field, Input, Select } from '@crm/ui';
import { RANGE_PRESETS, isFiltered, type AuditFilterState } from '../lib/filters';
import { useAuditWords } from './audit-labels';

/**
 * The filter bar. Every control writes straight to the URL (through `onChange`); the three free-text boxes (search, record number,
 * request id) keep a draft and apply on Enter or on leaving the box, so a half-typed id never fires a request.
 */
export function AuditFilters({
  state,
  facets,
  onChange,
  onReset,
  onRefresh,
}: {
  state: AuditFilterState;
  facets: AuditLogFacets | undefined;
  onChange: (patch: Partial<AuditFilterState>) => void;
  onReset: () => void;
  onRefresh: () => void;
}) {
  const t = useTranslations('audit-log');
  const words = useAuditWords();
  const [q, setQ] = useState(state.q);
  const [recordId, setRecordId] = useState(state.recordId);
  const [requestId, setRequestId] = useState(state.requestId);
  useEffect(() => setQ(state.q), [state.q]);
  useEffect(() => setRecordId(state.recordId), [state.recordId]);
  useEffect(() => setRequestId(state.requestId), [state.requestId]);

  const apply = () => {
    const rid = recordId.trim();
    onChange({
      q: q.trim(),
      recordId: /^\d{1,15}$/.test(rid) ? rid : '',
      requestId: requestId.trim(),
    });
  };

  return (
    <form
      role="search"
      aria-label={t('filters.label')}
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      className="space-y-3 rounded-md border border-border p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('filters.range')} htmlFor="audit-range">
          <Select
            id="audit-range"
            value={state.range}
            onChange={(e) => onChange({ range: e.target.value as AuditFilterState['range'] })}
          >
            {RANGE_PRESETS.map((r) => (
              <option key={r} value={r}>
                {t(`ranges.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        {state.range === 'custom' && (
          <>
            <Field label={t('filters.from')} htmlFor="audit-from">
              <Input
                id="audit-from"
                type="date"
                value={state.from}
                max={state.to || undefined}
                onChange={(e) => onChange({ from: e.target.value })}
              />
            </Field>
            <Field label={t('filters.to')} htmlFor="audit-to">
              <Input
                id="audit-to"
                type="date"
                value={state.to}
                min={state.from || undefined}
                onChange={(e) => onChange({ to: e.target.value })}
              />
            </Field>
          </>
        )}
        <Field label={t('filters.actor')} htmlFor="audit-actor">
          <Select
            id="audit-actor"
            value={state.actorId}
            onChange={(e) => onChange({ actorId: e.target.value })}
          >
            <option value="">{t('filters.allActors')}</option>
            {facets?.actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filters.actorType')} htmlFor="audit-actor-type">
          <Select
            id="audit-actor-type"
            value={state.actorType}
            onChange={(e) => onChange({ actorType: e.target.value as AuditFilterState['actorType'] })}
          >
            <option value="">{t('filters.allActorTypes')}</option>
            {AUDIT_ACTOR_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`actorTypes.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filters.module')} htmlFor="audit-module">
          <Select
            id="audit-module"
            value={state.module}
            onChange={(e) => onChange({ module: e.target.value })}
          >
            <option value="">{t('filters.allModules')}</option>
            {facetOptions(facets?.modules, state.module).map((m) => (
              <option key={m} value={m}>
                {words.module(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filters.action')} htmlFor="audit-action">
          <Select
            id="audit-action"
            value={state.action}
            onChange={(e) => onChange({ action: e.target.value })}
          >
            <option value="">{t('filters.allActions')}</option>
            {facetOptions(facets?.actions, state.action).map((a) => (
              <option key={a} value={a}>
                {words.action(a)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('filters.search')} htmlFor="audit-q" hint={t('filters.searchHint')}>
          <Input
            id="audit-q"
            type="search"
            value={q}
            maxLength={100}
            onChange={(e) => setQ(e.target.value)}
            onBlur={apply}
          />
        </Field>
        <Field label={t('filters.recordId')} htmlFor="audit-record">
          <Input
            id="audit-record"
            inputMode="numeric"
            value={recordId}
            maxLength={15}
            onChange={(e) => setRecordId(e.target.value)}
            onBlur={apply}
          />
        </Field>
        <Field label={t('filters.requestId')} htmlFor="audit-request">
          <Input
            id="audit-request"
            value={requestId}
            maxLength={200}
            onChange={(e) => setRequestId(e.target.value)}
            onBlur={apply}
          />
        </Field>
        <div className="flex items-end">
          <Checkbox
            id="audit-support-only"
            className="pb-2"
            label={t('filters.supportOnly')}
            checked={state.actAs}
            onChange={(e) => onChange({ actAs: e.target.checked })}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="secondary">
          {t('filters.apply')}
        </Button>
        <Button type="button" variant="ghost" onClick={onRefresh}>
          {t('filters.refresh')}
        </Button>
        {isFiltered(state) && (
          <Button type="button" variant="ghost" onClick={onReset}>
            {t('filters.reset')}
          </Button>
        )}
      </div>
    </form>
  );
}

/** The facet values, plus the one in the URL even if the window no longer contains it (so the control never lies about its value). */
function facetOptions(values: string[] | undefined, current: string): string[] {
  const set = new Set(values ?? []);
  if (current) set.add(current);
  return [...set].sort();
}
