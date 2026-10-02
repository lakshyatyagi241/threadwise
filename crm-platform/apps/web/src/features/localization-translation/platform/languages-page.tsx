'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { languageListResponseSchema, type LanguageItem } from '@crm/contracts';
import { Alert, Button, Card, ConfirmDialog, Spinner, StatTile } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { errorKey } from '../lib';

const KEY = ['i18n', 'languages'] as const;
const NS = 'localization-translation.languages';

type Kind = 'toggle' | 'default' | 'delete';

/**
 * TW-I18N-001/003/004/005: the language registry, laid out like Reference's "Platform languages" page: three stat cards,
 * the catalog table (#, name, code, dir, On/Off pill, Default badge or Set, Delete) and two info cards on the side.
 * Adding a language is locked, exactly as in Reference (TW-I18N-006), so there is no add form.
 */
export function LanguagesPage() {
  const t = useTranslations(NS);
  const te = useTranslations('localization-translation.errors');
  const qc = useQueryClient();
  const { canRunDanger } = useOperator();
  const [pendingDelete, setPendingDelete] = useState<LanguageItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/i18n/languages', { schema: languageListResponseSchema, signal }),
  });
  const act = useMutation({
    mutationFn: ({ lang, kind }: { lang: LanguageItem; kind: Kind }) =>
      kind === 'delete'
        ? operatorFetch(`/i18n/languages/${lang.id}`, {
            method: 'DELETE',
            query: { rowVersion: lang.rowVersion },
          })
        : operatorFetch(`/i18n/languages/${lang.id}/${kind}`, {
            method: 'POST',
            body: { rowVersion: lang.rowVersion },
          }),
    onSuccess: (_d, { lang, kind }) => {
      setError(null);
      setNotice(
        kind === 'delete'
          ? t('flash.removed')
          : kind === 'default'
            ? t('flash.nowDefault', { name: lang.name })
            : t(lang.isActive ? 'flash.disabled' : 'flash.activated', { name: lang.name }),
      );
    },
    onError: (e) => {
      setNotice(null);
      setError(te(errorKey(e)));
    },
    // A conflict and a refusal both mean the list on screen is stale.
    onSettled: () => {
      setPendingDelete(null);
      return qc.invalidateQueries({ queryKey: KEY });
    },
  });

  if (q.isPending) return <Spinner label={t('loading')} />;
  if (q.isError) return <Alert tone="danger">{te('unexpected')}</Alert>;
  const { data, stats } = q.data;
  const busy = act.isPending || !canRunDanger;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('kicker')}
        title={
          <>
            {t('titleLead')} <span className="italic text-primary">{t('titleEm')}</span>
          </>
        }
        description={t('description')}
      />
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label={t('stats.total')} value={stats.total} hint={t('stats.totalHint')} />
        <StatTile
          label={t('stats.active')}
          value={stats.active}
          hint={t('stats.activeHint')}
          tone="accent"
        />
        <StatTile
          label={t('stats.default')}
          value={<span className="uppercase">{stats.defaultCode}</span>}
          hint={t('stats.defaultHint')}
        />
      </div>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('catalog')}
            </p>
            <h2 className="mt-1 text-lg font-semibold leading-tight">{t('allLanguages')}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[47.5rem] table-fixed text-[0.78rem]">
              <thead className="border-b border-border bg-muted text-muted-foreground">
                <tr>
                  <th className="w-[3.75rem] px-4 py-2.5 text-start font-medium">#</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t('columns.name')}</th>
                  <th className="w-[7.5rem] px-3 py-2.5 text-start font-medium">
                    {t('columns.code')}
                  </th>
                  <th className="w-20 px-3 py-2.5 text-start font-medium">{t('columns.dir')}</th>
                  <th className="w-[6.25rem] px-3 py-2.5 text-center font-medium">
                    {t('columns.active')}
                  </th>
                  <th className="w-[6.25rem] px-3 py-2.5 text-center font-medium">
                    {t('columns.default')}
                  </th>
                  <th className="w-[6.25rem] px-4 py-2.5">
                    <span className="sr-only">{t('columns.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-10 text-center text-sm text-muted-foreground"
                    >
                      {t('empty')}
                    </td>
                  </tr>
                )}
                {data.map((l) => (
                  <tr key={l.id} className="hover:bg-muted/60">
                    <td className="px-4 py-3 font-mono text-[0.7rem]">{l.sortOrder}</td>
                    <td className="px-3 py-3">
                      <div className="truncate font-semibold">{l.name}</div>
                      {l.nativeName && (
                        <div className="truncate text-[0.65rem] text-muted-foreground">
                          {l.nativeName}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono text-[0.7rem]" dir="ltr">
                      {l.code}
                    </td>
                    <td className="px-3 py-3 font-mono text-[0.7rem] uppercase">{l.direction}</td>
                    <td className="px-3 py-3 text-center">
                      <button
                        type="button"
                        aria-pressed={l.isActive}
                        aria-label={t('toggleLabel', { name: l.name })}
                        disabled={busy}
                        onClick={() => act.mutate({ lang: l, kind: 'toggle' })}
                        className={
                          'rounded-full border px-2.5 py-1 font-mono text-[0.65rem] disabled:opacity-60 ' +
                          (l.isActive
                            ? 'border-success/40 bg-success/15 text-success'
                            : 'border-border bg-muted text-muted-foreground')
                        }
                      >
                        {l.isActive ? t('on') : t('off')}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-center">
                      {l.isDefault ? (
                        <span className="rounded-full bg-brand px-2.5 py-1 font-mono text-[0.65rem] text-brand-foreground">
                          {t('defaultBadge')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => act.mutate({ lang: l, kind: 'default' })}
                          className="rounded-full border border-border px-2.5 py-1 font-mono text-[0.65rem] hover:bg-muted disabled:opacity-60"
                        >
                          {t('set')}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end">
                      {!l.isDefault && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger"
                          disabled={busy}
                          onClick={() => setPendingDelete(l)}
                        >
                          {t('delete')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <aside className="space-y-4 lg:sticky lg:top-6">
          <Card className="space-y-2 p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('pack.kicker')}
            </p>
            <h3 className="text-base font-semibold leading-tight">
              {t('pack.title', { count: stats.total })}
            </h3>
            <p className="text-xs leading-relaxed text-muted-foreground">{t('pack.body')}</p>
            <p className="pt-1 text-[0.7rem] leading-relaxed text-muted-foreground">
              {t('pack.note')}
            </p>
          </Card>
          <div className="rounded-md border border-success/40 bg-success/10 p-4">
            <p className="text-xs font-semibold text-success">{t('usedFor.title')}</p>
            <p className="mt-1 text-[0.7rem] leading-relaxed text-foreground">
              {t('usedFor.body')}
            </p>
          </div>
        </aside>
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('confirmDelete.title')}
        message={t('confirmDelete.message', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={act.isPending}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && act.mutate({ lang: pendingDelete, kind: 'delete' })}
      />
    </div>
  );
}
