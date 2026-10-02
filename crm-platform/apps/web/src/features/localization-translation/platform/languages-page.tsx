'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { languageListResponseSchema, type LanguageItem } from '@crm/contracts';
import { Alert, Badge, Button, ConfirmDialog, Spinner, StatTile, Switch } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { errorKey } from '../lib';

const KEY = ['i18n', 'languages'] as const;
const NS = 'localization-translation.languages';

/** TW-I18N-001/003/004/005: the language registry. Adding a language is locked, exactly as in Reference (TW-I18N-006). */
export function LanguagesPage() {
  const t = useTranslations(NS);
  const te = useTranslations('localization-translation.errors');
  const qc = useQueryClient();
  const { canRunDanger } = useOperator();
  const [pendingDelete, setPendingDelete] = useState<LanguageItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/i18n/languages', { schema: languageListResponseSchema, signal }),
  });
  const act = useMutation({
    mutationFn: ({ lang, kind }: { lang: LanguageItem; kind: 'toggle' | 'default' | 'delete' }) =>
      kind === 'delete'
        ? operatorFetch(`/i18n/languages/${lang.id}`, {
            method: 'DELETE',
            query: { rowVersion: lang.rowVersion },
          })
        : operatorFetch(`/i18n/languages/${lang.id}/${kind}`, {
            method: 'POST',
            body: { rowVersion: lang.rowVersion },
          }),
    onSuccess: () => setError(null),
    onError: (e) => setError(te(errorKey(e))),
    // A conflict and a refusal both mean the list on screen is stale.
    onSettled: () => {
      setPendingDelete(null);
      return qc.invalidateQueries({ queryKey: KEY });
    },
  });

  if (q.isPending) return <Spinner label={t('loading')} />;
  if (q.isError) return <Alert tone="danger">{te('unexpected')}</Alert>;
  const { data, stats } = q.data;
  const busy = act.isPending;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t('kicker')} title={t('title')} description={t('description')} />
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label={t('stats.total')} value={stats.total} />
        <StatTile label={t('stats.active')} value={stats.active} />
        <StatTile label={t('stats.default')} value={stats.defaultCode} tone="accent" />
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground">
            <tr>
              {(['language', 'code', 'direction', 'active', 'actions'] as const).map((c) => (
                <th key={c} className="px-3 py-2 text-start font-medium">
                  {t(`columns.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <span className="font-medium">{l.name}</span>
                  {l.nativeName && (
                    <span className="ms-2 text-muted-foreground">{l.nativeName}</span>
                  )}
                  {l.isDefault && (
                    <Badge tone="success" className="ms-2">
                      {t('defaultBadge')}
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 font-mono" dir="ltr">
                  {l.code}
                </td>
                <td className="px-3 py-2 uppercase">{l.direction}</td>
                <td className="px-3 py-2">
                  <Switch
                    checked={l.isActive}
                    label={t('toggleLabel', { name: l.name })}
                    disabled={!canRunDanger || busy || l.isDefault}
                    onCheckedChange={() => act.mutate({ lang: l, kind: 'toggle' })}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!canRunDanger || busy || l.isDefault || !l.isActive}
                      onClick={() => act.mutate({ lang: l, kind: 'default' })}
                    >
                      {t('makeDefault')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={!canRunDanger || busy || l.isDefault}
                      onClick={() => setPendingDelete(l)}
                    >
                      {t('delete')}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t('addLocked')}</p>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('confirmDelete.title')}
        message={t('confirmDelete.message', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={busy}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && act.mutate({ lang: pendingDelete, kind: 'delete' })}
      />
    </div>
  );
}
