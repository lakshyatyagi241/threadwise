'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { AuditDeltaValue } from '@crm/contracts';
import { Alert, Badge, Spinner } from '@crm/ui';
import { useAuditEntry } from '../api/hooks';
import { errorKey } from '../lib/errors';
import { isRedacted, showValue } from '../lib/format';
import { ActorCell, useAuditWords } from './audit-labels';

/**
 * One entry in the side panel: who, when, what, the request, and the field changes old to new. Opening it is audited by the server,
 * and the values arrive already masked (secrets always, personal data unless the viewer is the Owner), so nothing here decides
 * what may be shown; it only says that something was hidden.
 */
export function AuditDetail({ id }: { id: string }) {
  const t = useTranslations('audit-log');
  const locale = useLocale();
  const words = useAuditWords();
  const q = useAuditEntry(id);

  if (q.isPending) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Spinner label={t('states.loading')} />
        {t('states.loading')}
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="space-y-3">
        <Alert tone="danger">{t(`errors.${errorKey(q.error)}`)}</Alert>
      </div>
    );
  }

  const e = q.data;
  const fields = Object.entries(e.delta);
  const anyMasked = fields.some(([, v]) => v.masked);
  const when = new Date(e.at);

  return (
    <div className="space-y-5 text-sm">
      {e.actAs && (
        <Alert tone="warning" data-testid="audit-support-note">
          <p className="font-medium">{t('detail.supportTitle')}</p>
          <p className="mt-1">
            {t('detail.supportBody', { name: e.actor.name ?? t('actors.removedUser') })}
          </p>
          <p className="mt-1">
            {e.actAs.reason
              ? t('detail.supportReason', { reason: e.actAs.reason })
              : t('detail.supportNoReason')}
          </p>
          {e.actAs.readOnly === true && <p className="mt-1">{t('detail.supportReadOnly')}</p>}
        </Alert>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">{t('detail.when')}</dt>
        <dd>
          <time dateTime={e.at}>
            {when.toLocaleString(locale, { dateStyle: 'full', timeStyle: 'long' })}
          </time>
        </dd>
        <dt className="text-muted-foreground">{t('detail.who')}</dt>
        <dd>
          <ActorCell entry={e} />
        </dd>
        <dt className="text-muted-foreground">{t('detail.what')}</dt>
        <dd>
          <Badge>{words.action(e.action)}</Badge>{' '}
          <span dir="auto">{words.module(e.module)}</span>
        </dd>
        <dt className="text-muted-foreground">{t('detail.record')}</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs">{e.recordId}</span>
          {e.record.href && (
            <Link href={e.record.href} className="text-brand hover:underline">
              {t('detail.openRecord')}
            </Link>
          )}
        </dd>
        <dt className="text-muted-foreground">{t('detail.request')}</dt>
        <dd className="break-all font-mono text-xs">{e.requestId ?? '-'}</dd>
      </dl>

      <section aria-labelledby="audit-changes-title">
        <h3 id="audit-changes-title" className="mb-2 font-semibold">
          {t('detail.changes')}
        </h3>
        {fields.length === 0 ? (
          <p className="text-muted-foreground">{t('detail.noChanges')}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[420px] text-start">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t('detail.field')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t('detail.before')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t('detail.after')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {fields.map(([field, v]) => (
                  <tr key={field} data-testid="audit-change">
                    <th scope="row" className="px-3 py-2 text-start align-top font-mono text-xs">
                      {field}
                    </th>
                    <td className="px-3 py-2 align-top">
                      <Value v={v} side="old" />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Value v={v} side="new" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {anyMasked && (
          <p className="mt-2 text-xs text-muted-foreground" data-testid="audit-masked-note">
            {e.canReveal ? t('detail.maskedNoteOwner') : t('detail.maskedNote')}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{t('detail.audited')}</p>
      </section>
    </div>
  );
}

function Value({ v, side }: { v: AuditDeltaValue; side: 'old' | 'new' }) {
  const t = useTranslations('audit-log');
  const raw = v[side];
  if (raw === undefined || raw === null || raw === '') {
    return <span className="text-muted-foreground">-</span>;
  }
  const text = showValue(raw);
  if (isRedacted(raw)) {
    return (
      <Badge tone="neutral" title={t('detail.secretHint')}>
        {t('detail.secret')}
      </Badge>
    );
  }
  return (
    <span dir="auto" className="whitespace-pre-wrap break-words" title={v.masked ? t('detail.maskedHint') : undefined}>
      {text}
    </span>
  );
}
