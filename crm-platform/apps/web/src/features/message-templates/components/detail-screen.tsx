'use client';

import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import type { TemplateDetail, TemplateSubmitResult } from '@crm/contracts';
import { Button, Spinner, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useConnections, useRefreshTemplate, useSubmitTemplate, useTemplate } from '../api/hooks';
import { canSendViaApi, templateSendCurl } from '../lib/curl';
import { clearFlash, peekFlash } from '../lib/flash';
import { previewOfSummary } from '../lib/preview';
import { REJECTION_CODES, canEdit, canRefresh, isAwaitingReview } from '../lib/status-model';
import { connectionLabel, usableConnections } from '../lib/sync';
import { ErrorAlert } from './error-line';
import {
  AlertIcon,
  ArrowLeftIcon,
  ClockIcon,
  CopyIcon,
  PencilIcon,
  RefreshIcon,
  SendIcon,
  TemplateIcon,
  TickIcon,
  CloseIcon,
} from './icons';
import { MessageBubble } from './wa-bubble';
import { useErrorText, type ErrorText } from './use-error-text';

const CARD = 'rounded-2xl border border-border bg-background shadow-sm';
const LABEL = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';

/** TW-TPL-017/020/026, the Reference template page: identity and Meta sync on the left, preview and components on the right. */
export function TemplateDetailScreen({ id, apiBaseUrl }: { id: string; apiBaseUrl: string }) {
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
  return <Detail tpl={q.data} apiBaseUrl={apiBaseUrl} />;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-end font-medium">{children}</dd>
    </div>
  );
}

function Banner({
  tone,
  icon,
  title,
  children,
  action,
}: {
  tone: 'danger' | 'warning' | 'info';
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === 'info' ? 'status' : 'alert'}
      className={cn(
        'mb-4 flex flex-wrap items-start gap-3 rounded-2xl border px-4 py-3.5',
        tone === 'danger' && 'border-danger/40 bg-danger/10',
        tone === 'warning' && 'border-warning/40 bg-warning/10',
        tone === 'info' && 'border-primary/30 bg-primary/10',
      )}
    >
      <span
        className={cn(
          'mt-0.5 shrink-0',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
          tone === 'info' && 'text-primary',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-[12.5px]">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-0.5 text-[12px] leading-relaxed">{children}</div>}
      </div>
      {action}
    </div>
  );
}

function Detail({ tpl, apiBaseUrl }: { tpl: TemplateDetail; apiBaseUrl: string }) {
  const t = useTranslations('message-templates.detail');
  const ts = useTranslations('message-templates.status');
  const tt = useTranslations('message-templates.card.type');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const { toast } = useToast();
  const errorText = useErrorText();
  const mayEdit = useCan('tpl.templates.create');
  const maySync = useCan('tpl.templates.sync');
  const connections = useConnections();
  const refresh = useRefreshTemplate();
  const submit = useSubmitTemplate();
  const [outcome, setOutcome] = useState<Pick<
    TemplateSubmitResult,
    'metaError' | 'warnings'
  > | null>(() => peekFlash(tpl.id));
  // A save that came here with Meta's refusal or warnings shows them once.
  useEffect(() => clearFlash(tpl.id), [tpl.id]);
  const [failure, setFailure] = useState<ErrorText | null>(null);
  const [pick, setPick] = useState('');

  const usable = usableConnections(connections.data ?? []);
  const number = connections.data?.find((c) => c.id === tpl.connectionId);
  const metaStatus = (tpl.metaStatus ?? '').toUpperCase();
  const onMeta = tpl.metaTemplateId !== null;
  const isApproved = tpl.status === 'approved';
  const isRejected = tpl.status === 'rejected';
  const isPaused = tpl.status === 'paused';
  const notSubmitted = !onMeta && (tpl.status === 'pending' || tpl.status === 'draft');
  const inReview = isAwaitingReview(tpl.status) && onMeta;
  const quality = (tpl.qualityScore ?? 'UNKNOWN').toUpperCase();
  const typeLabel = tt.has(tpl.templateType) ? tt(tpl.templateType) : tpl.templateType;
  const crumb = [tpl.metaCategory ?? '', typeLabel].filter(Boolean).join(' · ').toUpperCase();

  const stamp = (iso: string | null) =>
    iso
      ? format.dateTime(new Date(iso), {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : '—';
  const ago = (iso: string | null) => (iso ? format.relativeTime(new Date(iso), now) : '—');

  const statusLabel = notSubmitted ? t('notSubmittedPill') : ts(tpl.status);
  const pillTone = notSubmitted
    ? 'bg-warning/15 text-warning ring-warning/30'
    : isApproved
      ? 'bg-success/15 text-success ring-success/30'
      : isRejected || tpl.status === 'disabled'
        ? 'bg-danger/10 text-danger ring-danger/30'
        : tpl.status === 'pending'
          ? 'bg-primary/10 text-primary ring-primary/30'
          : 'bg-warning/15 text-warning ring-warning/30';

  function run(kind: 'refresh' | 'submit') {
    setFailure(null);
    setOutcome(null);
    const done = {
      onSuccess: (r: TemplateSubmitResult) => {
        setOutcome(r);
        if (kind === 'refresh') toast(t('refreshed'));
        else if (!r.metaError) toast(t('submittedToast'));
      },
      onError: (e: unknown) => setFailure(errorText(e)),
    };
    if (kind === 'refresh') refresh.mutate(tpl.id, done);
    else submit.mutate({ id: tpl.id, connectionId: pick || undefined }, done);
  }
  const busy = refresh.isPending || submit.isPending;

  const rejectionText =
    tpl.rejectionReasonCode && REJECTION_CODES.includes(tpl.rejectionReasonCode)
      ? t(`rejection.${tpl.rejectionReasonCode}`)
      : tpl.rejectionReason;
  const refreshBtn = (label: string) =>
    maySync && canRefresh(tpl.status, tpl.metaTemplateId) ? (
      <button
        type="button"
        disabled={busy}
        onClick={() => run('refresh')}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
      >
        {refresh.isPending ? <Spinner /> : <RefreshIcon className="size-3.5" />}
        {label}
      </button>
    ) : null;

  const editHref = `/templates/${tpl.id}/edit`;
  const editable = mayEdit && canEdit(tpl.status, tpl.templateType);
  const submitBtn = (
    <div className="flex flex-wrap items-center gap-2">
      {usable.length > 1 && (
        <select
          aria-label={t('wabaAccount')}
          value={pick || tpl.connectionId || ''}
          onChange={(e) => setPick(e.target.value)}
          className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
        >
          {usable.map((c) => (
            <option key={c.id} value={c.id}>
              {connectionLabel(c)}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => run('submit')}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-60"
      >
        {submit.isPending ? <Spinner /> : <SendIcon className="size-3.5" />}
        {t('submitToMeta')}
      </button>
    </div>
  );

  return (
    <main className="px-4 py-7 sm:px-6 lg:px-7" data-testid="template-detail">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-3 self-start">
          <div className={cn(CARD, 'p-5')}>
            <div className="mb-3 grid size-12 place-items-center rounded-xl bg-brand/10 text-brand">
              <TemplateIcon className="size-6" />
            </div>
            <p className="mb-1 break-all font-serif text-[18px] leading-tight">{tpl.name}</p>
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {crumb}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                data-testid="status-badge"
                data-status={tpl.status}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1',
                  pillTone,
                )}
              >
                {inReview ? (
                  <ClockIcon className="size-3" />
                ) : isApproved ? (
                  <TickIcon className="size-3" />
                ) : isRejected ? (
                  <CloseIcon className="size-3" />
                ) : null}
                {statusLabel}
              </span>
              {isApproved && (
                <span
                  data-testid="quality-badge"
                  className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground ring-1 ring-border"
                >
                  {t('qualityPill', { quality })}
                </span>
              )}
            </div>
          </div>

          <div className={cn(CARD, 'p-4')}>
            <p className={cn(LABEL, 'mb-1')}>{t('facts.title')}</p>
            <dl className="divide-y divide-border">
              <Fact label={t('facts.status')}>{metaStatus || '—'}</Fact>
              <Fact label={t('facts.quality')}>{quality}</Fact>
              <Fact label={t('facts.category')}>{tpl.metaCategory ?? '—'}</Fact>
              <Fact label={t('facts.metaId')}>
                <span className="font-mono text-xs">{tpl.metaTemplateId ?? '—'}</span>
              </Fact>
              {tpl.submittedAt && (
                <Fact label={t('facts.submitted')}>{stamp(tpl.submittedAt)}</Fact>
              )}
              <Fact label={t('facts.synced')}>{ago(tpl.lastSyncedAt)}</Fact>
            </dl>
          </div>

          <div className={cn(CARD, 'p-4')}>
            <p className={cn(LABEL, 'mb-2')}>{t('wabaAccount')}</p>
            {number ? (
              <>
                <p className="text-[13px] font-medium">
                  {number.verifiedName || connectionLabel(number)}
                </p>
                <p className="text-[12px] text-muted-foreground">{number.phoneNumber}</p>
              </>
            ) : usable.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                {t('noWaba')}{' '}
                <Link href="/channels/whatsapp" className="font-medium text-brand underline">
                  {t('connectOne')}
                </Link>{' '}
                {t('noWabaTail')}
              </p>
            ) : (
              <p className="text-[12px] text-muted-foreground">{t('facts.numberUnknown')}</p>
            )}
          </div>

          <nav aria-label={t('related')} className={cn(CARD, 'p-2')}>
            <p className={cn(LABEL, 'px-3 pb-1 pt-2')}>{t('related')}</p>
            <Link
              href="/templates"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] hover:bg-muted"
            >
              <ArrowLeftIcon className="size-3.5" />
              {t('back')}
            </Link>
            {editable && (
              <Link
                href={editHref}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] hover:bg-muted',
                  inReview && 'opacity-60',
                )}
              >
                <PencilIcon className="size-3.5" />
                {t('editTemplate')}
              </Link>
            )}
            {isApproved && (
              <Link
                href="/broadcasts/create"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-brand hover:bg-muted"
              >
                <SendIcon className="size-3.5" />
                {t('useInBroadcast')}
              </Link>
            )}
          </nav>
        </aside>

        <section className="min-w-0">
          <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <nav
                aria-label={t('breadcrumb')}
                className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
              >
                <Link href="/templates" className="hover:underline">
                  {t('crumbTemplates')}
                </Link>{' '}
                / <span className="text-foreground">{t('crumbDetail')}</span>
              </nav>
              <h1 className="break-words font-serif text-[30px] font-normal leading-none tracking-tight sm:text-[40px]">
                {tpl.name}
              </h1>
              <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
                {[tpl.metaCategory, tpl.language, typeLabel].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 pb-1">
              {refreshBtn(t('refresh'))}
              {editable && (
                <Link
                  href={editHref}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-xs font-semibold text-brand-foreground hover:opacity-90"
                >
                  <PencilIcon className="size-3.5" />
                  {t('edit')}
                </Link>
              )}
            </div>
          </header>

          {failure && <ErrorAlert className="mb-4" error={failure} />}
          {outcome?.metaError && (
            <Banner
              tone="danger"
              icon={<AlertIcon className="size-5" />}
              title={t('banner.metaFailed')}
            >
              <span className="whitespace-pre-line break-words">{outcome.metaError}</span>
            </Banner>
          )}

          {notSubmitted && maySync && usable.length > 0 && (
            <Banner
              tone="warning"
              icon={<AlertIcon className="size-5" />}
              title={t('banner.notSubmitted')}
              action={submitBtn}
            >
              {t('banner.notSubmittedBody')}
            </Banner>
          )}
          {notSubmitted && usable.length === 0 && (
            <Banner
              tone="warning"
              icon={<AlertIcon className="size-5" />}
              title={t('banner.notSubmitted')}
            >
              {t('banner.notSubmittedNoWaba')}{' '}
              <Link href="/channels/whatsapp" className="font-medium text-brand underline">
                {t('connectOne')}
              </Link>
            </Banner>
          )}

          {inReview && (
            <Banner
              tone="info"
              icon={<ClockIcon className="size-5" />}
              title={t('banner.pending')}
              action={refreshBtn(t('refreshNow'))}
            >
              <span data-testid="banner-pending">{t('banner.pendingBody')}</span>
              {tpl.submittedAt && (
                <span className="mt-1 block font-mono text-[10.5px] text-muted-foreground">
                  {t('banner.submittedAgo', { when: ago(tpl.submittedAt) })}
                  {tpl.lastSyncedAt &&
                    ` · ${t('banner.checkedAgo', { when: ago(tpl.lastSyncedAt) })}`}
                </span>
              )}
            </Banner>
          )}

          {isRejected && (
            <Banner
              tone="danger"
              icon={<AlertIcon className="size-5" />}
              title={t('banner.rejected')}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  {maySync && !onMeta && usable.length > 0 && submitBtn}
                  {editable && (
                    <Link
                      href={editHref}
                      className="rounded-full bg-danger px-3.5 py-1.5 text-xs font-semibold text-danger-foreground hover:opacity-90"
                    >
                      {t('editResubmit')}
                    </Link>
                  )}
                </div>
              }
            >
              <span data-testid="banner-rejected">
                {rejectionText && <span className="block break-words">{rejectionText}</span>}
                {tpl.rejectionReasonCode && (
                  <span className="mt-0.5 block font-mono text-[10.5px]">
                    {t('banner.code')} {tpl.rejectionReasonCode}
                  </span>
                )}
              </span>
            </Banner>
          )}

          {isPaused && (
            <Banner
              tone="warning"
              icon={<AlertIcon className="size-5" />}
              title={t('banner.paused')}
            >
              {t('banner.pausedBody')}{' '}
              {tpl.pausedUntil && t('banner.pausedUntil', { when: stamp(tpl.pausedUntil) })}
            </Banner>
          )}
          {tpl.status === 'disabled' && (
            <Banner
              tone="danger"
              icon={<AlertIcon className="size-5" />}
              title={t('banner.disabled')}
            />
          )}
          {tpl.status === 'deleted' && (
            <Banner
              tone="warning"
              icon={<AlertIcon className="size-5" />}
              title={t('banner.deleted')}
            />
          )}

          {(outcome?.warnings ?? []).map((w, i) => (
            <div
              key={i}
              role="alert"
              className="mb-2 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-[12px]"
            >
              <AlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <span>{w.message}</span>
            </div>
          ))}

          <div className={cn(CARD, 'mb-4 overflow-hidden')}>
            <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-3">
              <h2 className="text-[13px] font-semibold">{t('preview.title')}</h2>
              <span className="text-[11px] text-muted-foreground">{t('preview.hint')}</span>
            </div>
            <div className="bg-muted p-5">
              <MessageBubble model={previewOfSummary(tpl)} className="max-w-sm text-[13px]" />
            </div>
          </div>

          <div className={cn(CARD, 'overflow-hidden')}>
            <div className="border-b border-border px-5 py-3">
              <h2 className="text-[13px] font-semibold">{t('components.title')}</h2>
            </div>
            <dl className="divide-y divide-border text-[13px]">
              {(tpl.header || tpl.attachmentType !== 'none') && (
                <div className="grid gap-1 px-5 py-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">{t('components.header')}</dt>
                  <dd className="break-words">
                    {tpl.attachmentType !== 'none'
                      ? t(`attachment.${tpl.attachmentType}`)
                      : tpl.header}
                    {tpl.headerLocation && (
                      <span className="ms-2 font-mono text-xs text-muted-foreground" dir="ltr">
                        {tpl.headerLocation.latitude}, {tpl.headerLocation.longitude}
                        {tpl.headerLocation.name ? ` · ${tpl.headerLocation.name}` : ''}
                      </span>
                    )}
                  </dd>
                </div>
              )}
              <div className="grid gap-1 px-5 py-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                <dt className="text-muted-foreground">{t('components.body')}</dt>
                <dd className="whitespace-pre-wrap break-words">{tpl.body || '—'}</dd>
              </div>
              {tpl.footer && (
                <div className="grid gap-1 px-5 py-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">{t('components.footer')}</dt>
                  <dd className="break-words">{tpl.footer}</dd>
                </div>
              )}
              {tpl.buttons.length > 0 && (
                <div className="grid gap-1 px-5 py-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">{t('components.buttons')}</dt>
                  <dd className="space-y-1">
                    {tpl.buttons.map((b, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] uppercase">
                          {b.type}
                        </span>
                        <span>{b.text}</span>
                        {(b.url ?? b.phone_number) && (
                          <span className="break-all text-xs text-muted-foreground" dir="ltr">
                            → {b.url ?? b.phone_number}
                          </span>
                        )}
                      </div>
                    ))}
                  </dd>
                </div>
              )}
              {tpl.codeExpirationMinutes !== null && (
                <div className="grid gap-1 px-5 py-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">{t('components.expiry')}</dt>
                  <dd>{t('components.expiryValue', { count: tpl.codeExpirationMinutes })}</dd>
                </div>
              )}
            </dl>
          </div>

          {canSendViaApi(tpl) && <CurlCard tpl={tpl} baseUrl={apiBaseUrl} />}
        </section>
      </div>
    </main>
  );
}

/** The ready-to-run `POST /templates/{id}/send` request for this template; the key is the person's own, shown once on the Developers page. */
function CurlCard({ tpl, baseUrl }: { tpl: TemplateDetail; baseUrl: string }) {
  const t = useTranslations('message-templates.detail.curl');
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const curl = templateSendCurl(baseUrl, tpl);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast(t('copyFailed'), 'danger');
    }
  };
  return (
    <div id="curl" className={cn(CARD, 'mt-4 scroll-mt-20 overflow-hidden')}>
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="text-[13px] font-semibold">{t('title')}</h2>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11px] font-medium hover:bg-muted"
        >
          {copied ? <TickIcon className="size-3" /> : <CopyIcon className="size-3" />}
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
      <p className="px-5 pt-3 text-xs text-muted-foreground">{t('intro')}</p>
      <pre
        dir="ltr"
        tabIndex={0}
        aria-label={t('title')}
        data-testid="template-curl"
        className="m-5 overflow-x-auto rounded-xl bg-foreground px-4 py-3 font-mono text-xs leading-relaxed text-background"
      >
        {curl}
      </pre>
      <p className="px-5 pb-4 text-xs text-muted-foreground">
        {t('keyHint')}{' '}
        <Link href="/developers" className="font-medium text-brand underline">
          {t('keyLink')}
        </Link>
      </p>
    </div>
  );
}
