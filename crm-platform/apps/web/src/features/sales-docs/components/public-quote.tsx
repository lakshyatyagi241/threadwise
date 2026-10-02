'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState, type ReactNode } from 'react';
import { Alert, Button, Checkbox, Field, Input, Modal, Spinner, Textarea, cn } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { LOCALES, LOCALE_COOKIE } from '@/i18n/locales';
import type { PublicDoc } from '../api/schemas';
import { publicApi } from '../api/service';
import { errorKind } from '../lib/errors';
import { formatDateTime, formatDay } from '../lib/format';
import { formatMoney } from '../lib/money';
import { paperFromPublic } from '../lib/paper';
import type { DocStatus } from '../lib/status';
import { DocumentPaper, PrintSheet, printDocument } from './document-paper';
import { AlertIcon, CheckIcon, PrintIcon, XIcon } from './icons';
import { SignaturePad } from './signature-pad';

const LANGUAGES: Array<{ id: string; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'ar', label: 'العربية' },
];

const QUERY_KEY = (token: string) => ['sales-docs', 'public', token] as const;

/**
 * The buyer's page, `/q/<token>`: no login, no app shell. It shows the document as it will print and, while it is open and in
 * date, Accept (with the signer's name and a signature) and Decline (with an optional reason). A document that has lapsed, was
 * decided, was converted, has a revoked link or does not exist says so instead of offering buttons. A decision is final here:
 * to change it the buyer contacts the seller.
 */
export function PublicQuote({ token }: { token: string }) {
  const t = useTranslations('sales-docs.public');
  const q = useQuery({
    queryKey: QUERY_KEY(token),
    queryFn: ({ signal }) => publicApi.get(token, signal),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="min-h-dvh bg-muted/60 print:bg-white">
      <PublicHeader seller={q.data?.seller.name} onPrint={q.data ? printDocument : undefined} />
      <main className="mx-auto w-full max-w-[880px] px-3 pb-16 pt-5 sm:px-4 sm:pt-8">
        {q.isPending ? (
          <div role="status" aria-label={t('loading')} className="space-y-4">
            <div className="h-24 animate-pulse rounded-xl bg-background" />
            <div className="h-96 animate-pulse rounded-xl bg-background" />
          </div>
        ) : q.isError ? (
          <ProblemCard error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <Quote token={token} doc={q.data} />
        )}
      </main>
    </div>
  );
}

function PublicHeader({ seller, onPrint }: { seller?: string; onPrint?: () => void }) {
  const t = useTranslations('sales-docs.public');
  const locale = useLocale();
  const router = useRouter();
  const id = useId();

  function setLocale(next: string) {
    try {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* the language is not remembered */
    }
    router.refresh();
  }

  return (
    <header className="border-b border-border bg-background print:hidden">
      <div className="mx-auto flex w-full max-w-[880px] items-center justify-between gap-3 px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-foreground"
          >
            {(seller ?? '?').trim().slice(0, 1).toUpperCase()}
          </span>
          <span className="truncate text-sm font-semibold" dir="auto">
            {seller || t('brandFallback')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={id} className="sr-only">
            {t('language')}
          </label>
          <select
            id={id}
            value={LANGUAGES.some((l) => l.id === locale) ? locale : 'en'}
            onChange={(e) => setLocale(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {LANGUAGES.filter((l) => (LOCALES as readonly string[]).includes(l.id)).map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          {onPrint && (
            <Button size="sm" variant="secondary" className="h-9" onClick={onPrint}>
              <PrintIcon /> {t('print')}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

function Card({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'neutral' | 'success' | 'danger' | 'warning';
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  const tones = {
    neutral: 'border-border bg-background',
    success: 'border-success/40 bg-success/10',
    danger: 'border-danger/40 bg-danger/10',
    warning: 'border-warning/40 bg-warning/10',
  } as const;
  const text = {
    neutral: '',
    success: 'text-success',
    danger: 'text-danger',
    warning: 'text-warning',
  } as const;
  return (
    <div
      role={tone === 'neutral' ? 'status' : 'alert'}
      className={cn('flex gap-3 rounded-xl border p-4 print:hidden', tones[tone])}
    >
      <span className={cn('mt-0.5 shrink-0', text[tone])}>{icon}</span>
      <div className="min-w-0">
        <h2 className={cn('text-sm font-semibold', text[tone])}>{title}</h2>
        {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

/** The link is wrong, was revoked or has run out, or the server cannot be reached: nothing about the document is shown. */
function ProblemCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useTranslations('sales-docs.public');
  const kind = error instanceof ApiError ? errorKind(error) : 'network';
  const gone = kind === 'linkUnavailable';
  const invalid = kind === 'notFound' || kind === 'unavailable' || kind === 'validation';
  const key = gone ? 'gone' : invalid ? 'invalid' : 'error';
  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border border-border bg-background p-8 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <AlertIcon className="size-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold">{t(`${key}.title`)}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t(`${key}.message`)}</p>
      {key === 'error' && (
        <Button className="mt-5" variant="secondary" onClick={onRetry}>
          {t('error.retry')}
        </Button>
      )}
    </div>
  );
}

function Quote({ token, doc }: { token: string; doc: PublicDoc }) {
  const t = useTranslations('sales-docs.public');
  const tk = useTranslations('sales-docs.kind');
  const locale = useLocale();
  const kindWord = tk(`${doc.kind}.singular`).toLowerCase();
  const seller = doc.seller.name || t('brandFallback');
  // The server already reads a lapsed open document as expired; `blockedReason` says why a decision is not offered.
  const status: DocStatus = doc.blockedReason === 'expired' ? 'expired' : doc.status;
  const paper = paperFromPublic({ ...doc, status });

  return (
    <div className="space-y-4">
      {status === 'accepted' && (
        <Card
          tone="success"
          icon={<CheckIcon className="size-5" />}
          title={t('banner.accepted', { kind: kindWord, seller })}
        >
          {doc.decision?.signerName && (
            <span>
              {t('banner.signedBy', { name: doc.decision.signerName })}
              {doc.decision.decidedAt ? ` · ${formatDateTime(doc.decision.decidedAt, locale)}` : ''}
            </span>
          )}
        </Card>
      )}
      {status === 'declined' && (
        <Card
          tone="danger"
          icon={<XIcon className="size-5" />}
          title={t('banner.declined', { kind: kindWord })}
        >
          {t('banner.declinedHint', { seller })}
        </Card>
      )}
      {status === 'converted' && (
        <Card
          tone="success"
          icon={<CheckIcon className="size-5" />}
          title={t('banner.converted', { kind: kindWord })}
        />
      )}
      {status === 'expired' && (
        <Card
          tone="warning"
          icon={<AlertIcon className="size-5" />}
          title={t('banner.expired', { kind: kindWord, date: formatDay(doc.validUntil, locale) })}
        >
          {t('banner.expiredHint', { seller })}
        </Card>
      )}

      <div className="overflow-hidden rounded-xl border border-border shadow-sm print:border-0 print:shadow-none">
        <DocumentPaper doc={paper} />
      </div>
      <PrintSheet doc={paper} />

      {doc.canDecide && (
        <DecisionCard token={token} doc={doc} kindWord={kindWord} seller={seller} />
      )}

      <footer className="pt-2 text-center text-xs text-muted-foreground print:hidden">
        {t('footer', { kind: kindWord, seller })}
      </footer>
    </div>
  );
}

function DecisionCard({
  token,
  doc,
  kindWord,
  seller,
}: {
  token: string;
  doc: PublicDoc;
  kindWord: string;
  seller: string;
}) {
  const t = useTranslations('sales-docs.public.decision');
  const locale = useLocale();
  const qc = useQueryClient();
  const base = useId();
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [typed, setTyped] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  /** The decision is recorded: read the document again so the page shows the server's own account of it. */
  const done = async () => {
    await qc.invalidateQueries({ queryKey: QUERY_KEY(token) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const failed = (e: unknown) => {
    const kind = e instanceof ApiError ? errorKind(e) : 'network';
    setProblem(
      kind === 'expired'
        ? t('problem.expired')
        : kind === 'invalidTransition' || kind === 'alreadyDecided'
          ? t('problem.closed')
          : kind === 'linkUnavailable'
            ? t('problem.gone')
            : kind === 'rateLimited'
              ? t('problem.rateLimited')
              : kind === 'validation'
                ? t('problem.validation')
                : t('problem.generic'),
    );
    // The page may be out of date (decided in another tab, lapsed meanwhile): show what is true now.
    if (
      kind === 'expired' ||
      kind === 'invalidTransition' ||
      kind === 'alreadyDecided' ||
      kind === 'linkUnavailable'
    ) {
      void qc.invalidateQueries({ queryKey: QUERY_KEY(token) });
    }
  };

  const accept = useMutation({
    mutationFn: () =>
      publicApi.accept(token, {
        signerName: name.trim(),
        signature: typed ? null : signature,
        consent: true,
      }),
    onSuccess: done,
    onError: failed,
  });
  const decline = useMutation({
    mutationFn: () =>
      publicApi.decline(token, {
        signerName: name.trim(),
        signature: null,
        reason: reason.trim() || undefined,
      }),
    onSuccess: async () => {
      setDeclining(false);
      await done();
    },
    onError: (e) => {
      setDeclining(false);
      failed(e);
    },
  });

  const signed = typed || signature !== null;
  const ready = name.trim().length >= 2 && agree && signed;
  const busy = accept.isPending || decline.isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    setProblem(null);
    if (ready && !busy) accept.mutate();
  }

  return (
    <section
      aria-labelledby={`${base}-h`}
      className="rounded-xl border border-border bg-background p-5 shadow-sm print:hidden sm:p-6"
    >
      <h2 id={`${base}-h`} className="text-base font-semibold">
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('intro', {
          kind: kindWord,
          total: formatMoney(doc.totalMinor, doc.currency, locale),
          seller,
        })}
      </p>

      <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
        <Field
          label={t('name')}
          htmlFor={`${base}-name`}
          hint={t('nameHint')}
          error={tried && name.trim().length < 2 ? t('nameRequired') : undefined}
        >
          <Input
            id={`${base}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoComplete="name"
            invalid={tried && name.trim().length < 2}
            dir="auto"
          />
        </Field>

        <div className="space-y-2">
          <div className="text-sm font-medium" id={`${base}-sig`}>
            {t('signature')}
          </div>
          {typed ? (
            <div
              aria-describedby={`${base}-sig`}
              className="flex h-32 items-center justify-center rounded-md border border-dashed border-[#94a3b8] bg-white px-4 text-3xl italic text-[#0f172a]"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
              dir="auto"
            >
              {name.trim() || (
                <span className="text-base not-italic text-[#94a3b8]">{t('typedPlaceholder')}</span>
              )}
            </div>
          ) : (
            <SignaturePad onChange={setSignature} describedBy={`${base}-sig`} />
          )}
          <Checkbox
            checked={typed}
            onChange={(e) => {
              setTyped(e.target.checked);
              setSignature(null);
            }}
            label={t('useTyped')}
          />
          {tried && !signed && (
            <p role="alert" className="text-xs text-danger">
              {t('signatureRequired')}
            </p>
          )}
        </div>

        <div>
          <Checkbox
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            label={t('agree', { kind: kindWord })}
          />
          {tried && !agree && (
            <p role="alert" className="mt-1 text-xs text-danger">
              {t('agreeRequired')}
            </p>
          )}
        </div>

        {problem && <Alert tone="danger">{problem}</Alert>}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="brand" className="h-11 px-6" disabled={busy}>
            {accept.isPending ? <Spinner /> : <CheckIcon />} {t('accept', { kind: kindWord })}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-11 px-6 text-danger"
            disabled={busy}
            onClick={() => {
              setProblem(null);
              setDeclining(true);
            }}
          >
            <XIcon /> {t('decline')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('note')}</p>
      </form>

      <Modal
        open={declining}
        onClose={() => {
          if (!decline.isPending) setDeclining(false);
        }}
        title={t('declineTitle', { kind: kindWord })}
        closeLabel={t('close')}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={decline.isPending}
              onClick={() => setDeclining(false)}
            >
              {t('keep')}
            </Button>
            <Button variant="danger" disabled={decline.isPending} onClick={() => decline.mutate()}>
              {decline.isPending && <Spinner />} {t('declineConfirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('declineMessage', { kind: kindWord, seller })}
          </p>
          <Field label={t('reason')} htmlFor={`${base}-reason`} hint={t('reasonHint', { seller })}>
            <Textarea
              id={`${base}-reason`}
              rows={3}
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              dir="auto"
            />
          </Field>
        </div>
      </Modal>
    </section>
  );
}
