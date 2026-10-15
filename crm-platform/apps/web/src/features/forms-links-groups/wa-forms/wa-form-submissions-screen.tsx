'use client';

import { useTranslations } from 'next-intl';
import { Alert, EmptyState, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useWaFormSubmissions } from '../api/wa-forms-hooks';
import { waFormsApi } from '../api/wa-forms-service';
import { useErrorText } from '../components/use-error-text';

/** `/wa-forms/[id]/submissions`: one column per form field, newest first, CSV export (TW-WFL-009/010). */
export function WaFormSubmissionsScreen({ id }: { id: string }) {
  const t = useTranslations('forms-links-groups.forms');
  const errorText = useErrorText();
  const canExport = useCan('wfl.form-submissions.export');
  const submissions = useWaFormSubmissions(id);

  if (submissions.isPending) {
    return (
      <div className="mx-auto max-w-5xl p-6 text-sm text-muted-foreground">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (submissions.isError) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <Alert tone="danger">{errorText(submissions.error).text}</Alert>
      </div>
    );
  }

  const { items, fieldLabels, metaFlowId } = submissions.data;
  const fieldIds = Object.keys(fieldLabels);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <a href={`/wa-forms`} className="text-sm text-muted-foreground hover:underline">
            {t('builder.back')}
          </a>
          <h1 className="mt-1 text-2xl font-semibold">{t('submissions.heading')}</h1>
          {metaFlowId && <p className="text-xs text-muted-foreground">{t('submissions.metaFlowId', { id: metaFlowId })}</p>}
        </div>
        {canExport && items.length > 0 && (
          <a
            href={waFormsApi.exportUrl(id)}
            className="inline-flex h-10 items-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
          >
            {t('submissions.export')}
          </a>
        )}
      </header>

      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyState title={t('submissions.empty.title')} message={t('submissions.empty.description')} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">{t('submissions.table.submitted')}</th>
                  <th className="px-4 py-2">{t('submissions.table.contact')}</th>
                  <th className="px-4 py-2">{t('submissions.table.phone')}</th>
                  {fieldIds.map((fid) => (
                    <th key={fid} className="px-4 py-2">
                      {fieldLabels[fid]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-4 py-3 text-muted-foreground">
                      {s.submittedAt ? new Date(s.submittedAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">{s.contactName ?? '—'}</td>
                    <td className="px-4 py-3">{s.contactPhone ?? '—'}</td>
                    {fieldIds.map((fid) => (
                      <td key={fid} className="px-4 py-3">
                        {s.answers[fid] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
