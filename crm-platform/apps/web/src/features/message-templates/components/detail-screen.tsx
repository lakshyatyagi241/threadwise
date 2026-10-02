'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { TemplateDetail, TemplateSubmitResult } from '@crm/contracts';
import { Alert, Button, Card, Spinner, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useConnections, useRefreshTemplate, useSubmitTemplate, useTemplate } from '../api/hooks';
import { previewOf, stateFromDetail } from '../lib/form-model';
import { canEdit, canRefresh, canSubmit, isAwaitingReview } from '../lib/status-model';
import { connectionLabel } from '../lib/sync';
import { CategoryBadge, QualityBadge, StatusBadge } from './badges';
import { DeleteTemplateDialog } from './delete-dialog';
import { ErrorAlert } from './error-line';
import { RefreshIcon } from './icons';
import { PhonePreview } from './message-bubble';
import { IssueList } from './lint-panel';
import { useErrorText, type ErrorText } from './use-error-text';

/** WD-TPL-017/020/026: the template as WhatsApp will show it, Meta's verdict, and the actions its status allows. */
export function TemplateDetailScreen({ id }: { id: string }) {
  const t = useTranslations('message-templates.detail');
  const errorText = useErrorText();
  const q = useTemplate(id, { poll: true });

  if (q.isPending)
    return (
      <div className="flex justify-center p-12">
        <Spinner label={t('loading')} />
      </div>
    );
  if (q.isError) {
    const e = errorText(q.error);
    return (
      <main className="mx-auto max-w-3xl space-y-3 px-4 py-7">
        <ErrorAlert error={e} />
        <div className="flex gap-2">
          {e.code !== 'TPL_NOT_FOUND' && (
            <Button variant="secondary" onClick={() => void q.refetch()}>
              {t('retry')}
            </Button>
          )}
          <Link
            href="/templates"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium"
          >
            {t('back')}
          </Link>
        </div>
      </main>
    );
  }
  return <Detail tpl={q.data} />;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-end font-medium">{children}</dd>
    </div>
  );
}

function Detail({ tpl }: { tpl: TemplateDetail }) {
  const t = useTranslations('message-templates.detail');
  const format = useFormatter();
  const router = useRouter();
  const { toast } = useToast();
  const errorText = useErrorText();
  const mayEdit = useCan('tpl.templates.create');
  const mayDelete = useCan('tpl.templates.delete');
  const maySync = useCan('tpl.templates.sync');
  const connections = useConnections();
  const refresh = useRefreshTemplate();
  const submit = useSubmitTemplate();
  const [outcome, setOutcome] = useState<TemplateSubmitResult | null>(null);
  const [failure, setFailure] = useState<ErrorText | null>(null);
  const [deleting, setDeleting] = useState(false);

  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : t('never');
  const number = connections.data?.find((c) => c.id === tpl.connectionId);
  const state = stateFromDetail(tpl);

  function run(kind: 'refresh' | 'submit') {
    setFailure(null);
    setOutcome(null);
    const m = kind === 'refresh' ? refresh : submit;
    m.mutate(tpl.id, {
      onSuccess: (r) => {
        setOutcome(r);
        if (kind === 'refresh') toast(t('refreshed'));
        else if (!r.metaError) toast(t('submittedToast'));
      },
      onError: (e) => setFailure(errorText(e)),
    });
  }

  const busy = refresh.isPending || submit.isPending;
  const hasPayload = Object.keys(tpl.metaPayload).length > 0;

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-7 sm:px-6">
      <nav aria-label={t('breadcrumb')} className="text-xs text-muted-foreground">
        <Link href="/templates" className="hover:underline">
          {t('back')}
        </Link>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold">{tpl.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge status={tpl.status} />
            <CategoryBadge category={tpl.metaCategory} />
            {tpl.status === 'approved' && <QualityBadge score={tpl.qualityScore} />}
            <span className="font-mono">{tpl.language}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {maySync && canRefresh(tpl.status, tpl.metaTemplateId) && (
            <Button variant="secondary" disabled={busy} onClick={() => run('refresh')}>
              {refresh.isPending ? <Spinner /> : <RefreshIcon className="size-4" />}
              {t('refresh')}
            </Button>
          )}
          {maySync && canSubmit(tpl.status) && (
            <Button disabled={busy} onClick={() => run('submit')}>
              {submit.isPending && <Spinner />}
              {t('retrySubmit')}
            </Button>
          )}
          {mayEdit && canEdit(tpl.status) && (
            <Link
              href={`/templates/${tpl.id}/edit`}
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              {t('edit')}
            </Link>
          )}
          {mayDelete && (
            <Button variant="danger" onClick={() => setDeleting(true)}>
              {t('delete')}
            </Button>
          )}
        </div>
      </header>

      {failure && <ErrorAlert error={failure} />}
      {outcome?.metaError && (
        <Alert tone="danger">
          <p className="font-medium">{t('banner.metaFailed')}</p>
          <p className="mt-1 whitespace-pre-line break-words">{outcome.metaError}</p>
        </Alert>
      )}
      {outcome && outcome.warnings.length > 0 && (
        <Alert tone="warning">
          <ul className="list-disc ps-5">
            {outcome.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <StatusBanner tpl={tpl} when={when} />

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <PhonePreview model={previewOf(state)} />
          <Card>
            <h2 className="mb-1 text-sm font-semibold">{t('facts.title')}</h2>
            <dl className="divide-y divide-border">
              <Fact label={t('facts.status')}>{tpl.metaStatus ?? t('none')}</Fact>
              <Fact label={t('facts.quality')}>{tpl.qualityScore ?? t('none')}</Fact>
              <Fact label={t('facts.category')}>{tpl.metaCategory ?? t('none')}</Fact>
              <Fact label={t('facts.metaId')}>
                <span className="font-mono text-xs">{tpl.metaTemplateId ?? t('none')}</span>
              </Fact>
              <Fact label={t('facts.number')}>
                {number
                  ? connectionLabel(number)
                  : tpl.connectionId
                    ? t('facts.numberUnknown')
                    : t('none')}
              </Fact>
              <Fact label={t('facts.submitted')}>{when(tpl.submittedAt)}</Fact>
              <Fact label={t('facts.approved')}>{when(tpl.approvedAt)}</Fact>
              <Fact label={t('facts.synced')}>{when(tpl.lastSyncedAt)}</Fact>
            </dl>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">{t('components.title')}</h2>
            <dl className="space-y-2 text-sm">
              {tpl.header && (
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">
                    {t('components.header')}
                  </dt>
                  <dd className="break-words">{tpl.header}</dd>
                </div>
              )}
              {tpl.attachmentType !== 'none' && (
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">
                    {t('components.media')}
                  </dt>
                  <dd>{t(`attachment.${tpl.attachmentType}`)}</dd>
                </div>
              )}
              {tpl.body && (
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">
                    {t('components.body')}
                  </dt>
                  <dd className="whitespace-pre-wrap break-words">{tpl.body}</dd>
                </div>
              )}
              {tpl.footer && (
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">
                    {t('components.footer')}
                  </dt>
                  <dd className="break-words">{tpl.footer}</dd>
                </div>
              )}
              {tpl.buttons.length > 0 && (
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">
                    {t('components.buttons')}
                  </dt>
                  <dd>
                    <ul className="space-y-1">
                      {tpl.buttons.map((b, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                            {b.type}
                          </span>
                          <span>{b.text}</span>
                          {(b.url ?? b.phone_number) && (
                            <span
                              className="break-all font-mono text-xs text-muted-foreground"
                              dir="ltr"
                            >
                              {b.url ?? b.phone_number}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
              {tpl.codeExpirationMinutes !== null && (
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">
                    {t('components.expiry')}
                  </dt>
                  <dd>{t('components.expiryValue', { count: tpl.codeExpirationMinutes })}</dd>
                </div>
              )}
            </dl>
          </Card>

          <Card className="space-y-2">
            <h2 className="text-sm font-semibold">{t('lint.title')}</h2>
            {tpl.lint.length === 0 ? (
              <p className="text-sm text-success">{t('lint.clean')}</p>
            ) : (
              <>
                {(
                  ['name', 'language', 'header', 'body', 'footer', 'buttons', 'template'] as const
                ).map((f) => (
                  <div key={f}>
                    <IssueList issues={tpl.lint} field={f} />
                  </div>
                ))}
              </>
            )}
          </Card>

          <Card className="space-y-2">
            <h2 className="text-sm font-semibold">{t('payload.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('payload.hint')}</p>
            {hasPayload ? (
              <pre
                tabIndex={0}
                aria-label={t('payload.title')}
                dir="ltr"
                className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs"
                data-testid="meta-payload"
              >
                {JSON.stringify(tpl.metaPayload, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">{t('payload.empty')}</p>
            )}
          </Card>
        </div>
      </div>

      <DeleteTemplateDialog
        template={deleting ? { id: tpl.id, name: tpl.name } : null}
        onClose={() => setDeleting(false)}
        onDeleted={() => router.push('/templates')}
      />
    </main>
  );
}

/** The one banner that tells the operator where the template stands with Meta. */
function StatusBanner({
  tpl,
  when,
}: {
  tpl: TemplateDetail;
  when: (iso: string | null) => string;
}) {
  const t = useTranslations('message-templates.detail.banner');
  switch (tpl.status) {
    case 'draft':
      return <Alert tone="warning">{t('draft')}</Alert>;
    case 'pending':
      return (
        <Alert tone="info" data-testid="banner-pending">
          <p className="font-medium">{t('pending')}</p>
          <p className="mt-1 text-xs">
            {t('pendingMeta', {
              submitted: when(tpl.submittedAt),
              checked: when(tpl.lastSyncedAt),
            })}
          </p>
          {isAwaitingReview(tpl.status) && <p className="mt-1 text-xs">{t('polling')}</p>}
        </Alert>
      );
    case 'rejected':
      return (
        <Alert tone="danger" data-testid="banner-rejected">
          <p className="font-medium">{t('rejected')}</p>
          {tpl.rejectionReason && (
            <p className="mt-1 whitespace-pre-line break-words">{tpl.rejectionReason}</p>
          )}
          <p className="mt-1 text-xs">{t('rejectedHelp')}</p>
        </Alert>
      );
    case 'paused':
      return (
        <Alert tone="warning">
          {tpl.pausedUntil ? t('pausedUntil', { when: when(tpl.pausedUntil) }) : t('paused')}
        </Alert>
      );
    case 'disabled':
      return <Alert tone="danger">{t('disabled')}</Alert>;
    case 'deleted':
      return <Alert tone="warning">{t('deleted')}</Alert>;
    case 'approved':
      return null;
  }
}
