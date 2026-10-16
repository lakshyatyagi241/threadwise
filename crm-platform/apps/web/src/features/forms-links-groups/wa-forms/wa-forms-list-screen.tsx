'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { WaForm } from '@crm/contracts';
import { Alert, Button, ConfirmDialog, EmptyState, Spinner, StatTile } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import {
  useCreateWaForm,
  useDeleteWaForm,
  useDuplicateWaForm,
  useWaForms,
} from '../api/wa-forms-hooks';
import { useErrorText } from '../components/use-error-text';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral'> = {
  published: 'success',
  paused: 'warning',
  draft: 'neutral',
};

/** `/wa-forms` (Reference "WhatsApp Forms"): list, KPI tiles, create, and the publish/duplicate/delete row actions. */
export function WaFormsListScreen() {
  const t = useTranslations('forms-links-groups.forms');
  const errorText = useErrorText();
  const canCreate = useCan('wfl.forms.create');
  const canManage = useCan('wfl.forms.manage');
  const canDelete = useCan('wfl.forms.delete');

  const forms = useWaForms();
  const create = useCreateWaForm();
  const duplicate = useDuplicateWaForm();
  const remove = useDeleteWaForm();
  const [deleting, setDeleting] = useState<WaForm | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const items = forms.data?.items ?? [];
  const stats = forms.data?.stats;

  const onCreate = () => {
    create.mutate(
      {
        title: t('create.defaultTitle'),
        audienceType: 'lead_capture',
        submissionCap: 0,
        sendButtonLabel: 'Send',
        definition: {
          screens: [
            {
              id: 'A',
              fields: [
                { id: 'name', kind: 'short_text', label: t('create.defaultField'), required: true },
              ],
            },
          ],
        },
      },
      {
        onSuccess: (form) => {
          window.location.href = `/wa-forms/${form.id}`;
        },
        onError: (err) => setNotice({ tone: 'danger', text: errorText(err).text }),
      },
    );
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold leading-none">{t('heading')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        {canCreate && (
          <Button onClick={onCreate} disabled={create.isPending}>
            {create.isPending ? t('create.creating') : t('create.cta')}
          </Button>
        )}
      </header>

      {notice && (
        <Alert tone={notice.tone} className="mt-4">
          {notice.text}
        </Alert>
      )}

      {stats && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label={t('stats.all')} value={stats.all} />
          <StatTile label={t('stats.published')} value={stats.published} />
          <StatTile label={t('stats.draft')} value={stats.draft} />
          <StatTile label={t('stats.submissions')} value={stats.submissions} />
        </div>
      )}

      <div className="mt-6">
        {forms.isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> {t('loading')}
          </div>
        ) : forms.isError ? (
          <Alert tone="danger">
            {errorText(forms.error).text}{' '}
            <button type="button" className="underline" onClick={() => forms.refetch()}>
              {t('retry')}
            </button>
          </Alert>
        ) : items.length === 0 ? (
          <EmptyState title={t('empty.title')} message={t('empty.description')} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-start text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">{t('table.form')}</th>
                  <th className="px-4 py-2">{t('table.type')}</th>
                  <th className="px-4 py-2">{t('table.fields')}</th>
                  <th className="px-4 py-2">{t('table.submissions')}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((form) => (
                  <tr key={form.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <a href={`/wa-forms/${form.id}`} className="font-medium hover:underline">
                        {form.title}
                      </a>
                      <div className="mt-1">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            STATUS_TONE[form.status] === 'success'
                              ? 'bg-success/10 text-success'
                              : STATUS_TONE[form.status] === 'warning'
                                ? 'bg-warning/10 text-warning'
                                : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {t(`status.${form.status}`)}
                        </span>
                        {form.publishError && (
                          <span className="ms-2 text-xs text-danger">{form.publishError}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {t(`audience.${form.audienceType}`)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{form.fieldsCount}</td>
                    <td className="px-4 py-3">
                      <a href={`/wa-forms/${form.id}/submissions`} className="hover:underline">
                        {form.submissionCount}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-end">
                      <div className="inline-flex gap-2">
                        {canManage && (
                          <a
                            href={`/wa-forms/${form.id}`}
                            className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
                          >
                            {t('row.edit')}
                          </a>
                        )}
                        {canManage && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={duplicate.isPending}
                            onClick={() =>
                              duplicate.mutate(form.id, {
                                onError: (err) =>
                                  setNotice({ tone: 'danger', text: errorText(err).text }),
                              })
                            }
                          >
                            {t('row.duplicate')}
                          </Button>
                        )}
                        {canDelete && (
                          <Button variant="secondary" size="sm" onClick={() => setDeleting(form)}>
                            <span className="text-danger">{t('row.delete')}</span>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title={t('confirm.deleteTitle')}
        message={t('confirm.deleteMessage')}
        confirmLabel={t('confirm.deleteConfirm')}
        cancelLabel={t('confirm.cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => setDeleting(null),
            onError: (err) => {
              setDeleting(null);
              setNotice({ tone: 'danger', text: errorText(err).text });
            },
          });
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
