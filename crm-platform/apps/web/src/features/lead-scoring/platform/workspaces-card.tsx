'use client';

import { useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Field, Input, Select } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { DEFAULT_LIMIT, LIMIT_CHOICES, WORKSPACES_KEY, workspacesSchema } from './queries';
import { ErrorBlock, LoadingBlock } from './state';
import { useDebounced } from './use-debounced';
import { useUsd } from './use-usd';

const NS = 'lead-scoring-admin.workspaces';
export const SEARCH_DEBOUNCE_MS = 300;

/** Workspaces by what scoring cost them over 30 days (highest first), with a debounced name search. */
export function WorkspacesCard() {
  const t = useTranslations(NS);
  const format = useFormatter();
  const usd = useUsd();
  const id = useId();
  const [text, setText] = useState('');
  const [limit, setLimit] = useState<number>(DEFAULT_LIMIT);
  const search = useDebounced(text.trim(), SEARCH_DEBOUNCE_MS);

  const q = useQuery({
    queryKey: [...WORKSPACES_KEY, search, limit],
    queryFn: ({ signal }) =>
      operatorFetch('/lead-scoring/workspaces', {
        query: { search: search || undefined, limit },
        schema: workspacesSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const n = (v: number) => format.number(v);
  const rows = q.data?.data ?? [];

  return (
    <Card className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('search')} htmlFor={`${id}-search`} className="min-w-52 flex-1">
          <Input
            id={`${id}-search`}
            type="search"
            value={text}
            maxLength={100}
            placeholder={t('searchPlaceholder')}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <Field label={t('limit')} htmlFor={`${id}-limit`} className="w-36">
          <Select
            id={`${id}-limit`}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {LIMIT_CHOICES.map((c) => (
              <option key={c} value={c}>
                {t('limitOption', { count: c })}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError && !q.data ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        search ? (
          <EmptyState
            title={t('noMatchTitle')}
            message={t('noMatchMessage')}
            actions={
              <Button variant="secondary" size="sm" onClick={() => setText('')}>
                {t('clearSearch')}
              </Button>
            }
          />
        ) : (
          <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} />
        )
      ) : (
        <>
          {q.isError && <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm" aria-label={t('tableLabel')}>
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pe-3 text-start font-medium">
                    {t('columns.name')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t('columns.enabled')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">
                    {t('columns.contacts')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">
                    {t('columns.scores')}
                  </th>
                  <th scope="col" className="ps-3 py-2 text-end font-medium">
                    {t('columns.cost')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.workspaceId} className="border-b last:border-0">
                    <th scope="row" className="py-2 pe-3 text-start font-medium">
                      {w.name}
                    </th>
                    <td className="px-3 py-2">
                      <Badge
                        tone={w.enabled ? 'success' : 'neutral'}
                        className={w.enabled ? '' : 'text-foreground'}
                      >
                        {w.enabled ? t('enabled') : t('disabled')}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">{n(w.contactsScored)}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{n(w.scores30d)}</td>
                    <td className="ps-3 py-2 text-end tabular-nums" dir="ltr">
                      {usd(w.costUsd30d)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
