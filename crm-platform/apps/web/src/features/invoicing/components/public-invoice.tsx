'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import type { PublicInvoice as PublicInvoiceData, PublicPayResponse } from '@crm/contracts';
import { Alert, Button, Field, Input, Spinner } from '@crm/ui';
import { PublicInvoiceGone } from '../api/http';
import { invoicingApi } from '../api/service';
import { errorCode } from '../lib/errors';
import { formatDay } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { paperFromPublic } from '../lib/paper';
import { decimalOf } from '../lib/builder';
import { majorToMinor } from '../lib/wire';
import { CheckIcon, CopyIcon, DownloadIcon, ExternalIcon, InvoiceIcon, PrinterIcon } from './icons';
import { InvoicePaper } from './invoice-paper';
import { StatusChip } from './parts';

/**
 * The buyer's page, `/i/[token]`, outside the app shell: no sign-in, nothing internal, never indexed. It shows the invoice as the
 * paper, says clearly whether it is open, paid or cancelled, lets the buyer print or download it, and shows how to pay: the bank
 * transfer instructions and details, and a "Pay now" button (a partial amount is allowed) when the seller connected an online
 * provider. A link that does not exist, or was withdrawn or expired, gets its own plain page.
 */
export function PublicInvoice({ token }: { token: string }) {
  const t = useTranslations('invoicing.public');
  const q = useQuery({
    queryKey: ['invoicing', 'public', token],
    queryFn: () => invoicingApi.publicInvoice(token),
    retry: (n, e) => !(e instanceof PublicInvoiceGone) && n < 2,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  if (q.isPending) {
    return (
      <Shell>
        <div
          role="status"
          className="flex items-center justify-center gap-2 py-24 text-muted-foreground"
        >
          <Spinner /> {t('loading')}
        </div>
      </Shell>
    );
  }
  if (q.isError || !q.data) {
    const gone = q.error instanceof PublicInvoiceGone ? q.error.status : null;
    return (
      <Shell>
        <div className="mx-auto max-w-md rounded-xl border border-border bg-background px-6 py-12 text-center">
          <div
            aria-hidden="true"
            className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <InvoiceIcon className="size-6" />
          </div>
          <h1 className="text-lg font-semibold">
            {gone === 404
              ? t('notFoundTitle')
              : gone === 410
                ? t('unavailableTitle')
                : t('errorTitle')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {gone === 404
              ? t('notFoundMessage')
              : gone === 410
                ? t('unavailableMessage')
                : t('errorMessage')}
          </p>
          {gone === null && (
            <Button variant="secondary" className="mt-5 min-h-10" onClick={() => void q.refetch()}>
              {t('retry')}
            </Button>
          )}
        </div>
      </Shell>
    );
  }
  return (
    <Shell>
      <PublicInvoiceView token={token} data={q.data} onPaid={() => void q.refetch()} />
    </Shell>
  );
}

/** The loaded page: header, banners, the paper and the pay panel (exported for the render tests). */
export function PublicInvoiceView({
  token,
  data: p,
  onPaid,
}: {
  token: string;
  data: PublicInvoiceData;
  onPaid: () => void;
}) {
  const t = useTranslations('invoicing.public');
  const locale = useLocale();
  const paper = useMemo(() => paperFromPublic(p), [p]);
  const money = (n: number) => formatMoney(n, p.currency, locale);
  const balanceMinor = majorToMinor(p.amounts.balance, p.currencyExponent);
  const base = `/api/public/invoices/${encodeURIComponent(token)}`;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight" dir="auto">
            {t('title', { seller: p.seller.name ?? '' })}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span dir="ltr">{p.number}</span>
            <StatusChip status={p.status} />
            {p.dueDate && p.status !== 'paid' && p.status !== 'void' && (
              <span>{t('dueOn', { date: formatDay(p.dueDate, locale) })}</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" className="min-h-10" onClick={() => window.print()}>
            <PrinterIcon /> {t('print')}
          </Button>
          <a
            href={`${base}/pdf`}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <DownloadIcon /> {t('download')}
          </a>
        </div>
      </header>

      {p.status === 'paid' && (
        <Alert tone="success" className="flex items-center gap-2 print:hidden">
          <CheckIcon /> {t('paidBanner')}
        </Alert>
      )}
      {p.status === 'void' && (
        <Alert tone="warning" className="space-y-1 print:hidden">
          <p className="font-semibold">{t('voidBanner')}</p>
          {p.voidReason && (
            <p dir="auto" className="text-sm">
              {t('voidReason', { reason: p.voidReason })}
            </p>
          )}
        </Alert>
      )}

      <InvoicePaper model={paper} />

      {p.status !== 'void' && p.status !== 'paid' && p.status !== 'draft' && balanceMinor > 0 && (
        <PayPanel token={token} data={p} balanceMinor={balanceMinor} onPaid={onPaid} />
      )}

      <footer className="space-y-1 pb-6 text-center text-xs text-muted-foreground print:hidden">
        <p>
          <a
            className="text-primary underline underline-offset-2"
            href={`${base}/print`}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('printable')}
          </a>
        </p>
        {p.seller.email && (
          <p>
            {t('questions')}{' '}
            <a
              className="text-primary underline underline-offset-2"
              href={`mailto:${p.seller.email}`}
            >
              {p.seller.email}
            </a>
          </p>
        )}
        <p>{t('amountDueFooter', { amount: money(balanceMinor) })}</p>
      </footer>
    </div>
  );
}

/** How to pay: the bank details (with copy buttons) and, when the seller connected a provider, "Pay now" (any amount up to the balance). */
function PayPanel({
  token,
  data: p,
  balanceMinor,
  onPaid,
}: {
  token: string;
  data: PublicInvoiceData;
  balanceMinor: number;
  onPaid: () => void;
}) {
  const t = useTranslations('invoicing.public');
  const locale = useLocale();
  const money = (n: number) => formatMoney(n, p.currency, locale);
  const bank = p.paymentOptions.bankTransfer;
  const online = p.paymentOptions.online;
  const balanceText = p.amounts.balance;
  // Empty until the buyer types: the box then follows the balance (a payment may land while the page is open).
  const [typedText, setAmount] = useState<string | null>(null);
  const amount = typedText ?? balanceText;
  const [result, setResult] = useState<PublicPayResponse | null>(null);

  const typed = decimalOf(amount, p.currencyExponent);
  const typedMinor = typed === null ? null : majorToMinor(typed, p.currencyExponent);
  const amountError =
    typedMinor === null
      ? 'invalid'
      : typedMinor <= 0
        ? 'invalid'
        : typedMinor > balanceMinor
          ? 'tooMuch'
          : null;

  const pay = useMutation({
    mutationFn: () =>
      invoicingApi.publicPay(
        token,
        typedMinor !== null && typedMinor < balanceMinor ? (typed ?? undefined) : undefined,
      ),
    onSuccess: (r) => {
      setResult(r);
      // Redirect only to an https page (a provider checkout); anything else is not followed.
      if (r.kind === 'redirect' && r.url && /^https:\/\//i.test(r.url))
        window.location.assign(r.url);
      else onPaid();
    },
  });

  if (!bank && !online) {
    return (
      <section className="rounded-xl border border-border bg-background p-4 text-sm sm:p-5 print:hidden">
        <h2 className="text-base font-semibold">{t('payNow')}</h2>
        <p className="mt-1 text-muted-foreground">
          {t('amountDue')} <Amount value={money(balanceMinor)} />
        </p>
        <p className="mt-2 text-muted-foreground">{t('noPayOptions')}</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="pay-now"
      className="space-y-4 rounded-xl border border-border bg-background p-4 sm:p-5 print:hidden"
    >
      <div>
        <h2 id="pay-now" className="text-base font-semibold">
          {t('payNow')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('amountDue')} <Amount value={money(balanceMinor)} />
        </p>
      </div>

      {online && (
        <div className="space-y-3">
          <Field
            label={t('payAmount', { currency: p.currency })}
            htmlFor="pay-amount"
            hint={t('payAmountHint')}
            error={amountError ? t(`amountErrors.${amountError}`) : undefined}
          >
            <Input
              id="pay-amount"
              inputMode="decimal"
              dir="ltr"
              value={amount}
              invalid={!!amountError}
              onChange={(e) => setAmount(e.target.value)}
              className="max-w-48"
            />
          </Field>
          <Button
            variant="brand"
            className="min-h-11 w-full sm:w-auto"
            disabled={pay.isPending || !!amountError}
            onClick={() => pay.mutate()}
          >
            {pay.isPending ? <Spinner /> : null}
            {t('payButton', {
              amount: typedMinor !== null && !amountError ? money(typedMinor) : money(balanceMinor),
            })}{' '}
            <ExternalIcon />
          </Button>
          <p className="text-xs text-muted-foreground">{t('gatewayNote')}</p>
          {pay.isError && (
            <Alert tone="danger">
              {errorCode(pay.error) === 'INV_LINK_UNAVAILABLE'
                ? t('linkUnavailable')
                : t('payFailed')}
            </Alert>
          )}
          {result && <PayResult result={result} />}
        </div>
      )}

      {bank && (bank.instructions || (bank.details && Object.keys(bank.details).length > 0)) && (
        <div className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
          <h3 className="text-sm font-semibold">{t('bankTransfer')}</h3>
          <p className="text-sm">{t('bankIntro', { number: p.number })}</p>
          {bank.instructions && (
            <div className="space-y-2">
              <pre
                dir="auto"
                className="thin-scrollbar overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-muted px-3 py-2.5 font-sans text-sm"
              >
                {bank.instructions}
              </pre>
              <CopyButton text={bank.instructions} label={t('copyInstructions')} />
            </div>
          )}
          {bank.details && Object.keys(bank.details).length > 0 && (
            <BankDetails details={bank.details} />
          )}
        </div>
      )}
    </section>
  );
}

function PayResult({ result }: { result: PublicPayResponse }) {
  const t = useTranslations('invoicing.public');
  if (result.kind === 'unavailable')
    return <Alert tone="warning">{result.note || t('payUnavailable')}</Alert>;
  if (result.kind === 'redirect') {
    const ok = !!result.url && /^https:\/\//i.test(result.url);
    return (
      <Alert tone={ok ? 'info' : 'warning'} className="space-y-1">
        <p>{ok ? t('redirecting') : t('payUnavailable')}</p>
        {result.note && <p className="text-sm">{result.note}</p>}
      </Alert>
    );
  }
  return (
    <Alert tone="info" className="space-y-2">
      <p className="font-medium">{t('payInstructions')}</p>
      {result.instructions && (
        <p dir="auto" className="whitespace-pre-line text-sm">
          {result.instructions}
        </p>
      )}
      {result.details && Object.keys(result.details).length > 0 && (
        <BankDetails details={result.details} />
      )}
      {result.note && <p className="text-sm text-muted-foreground">{result.note}</p>}
    </Alert>
  );
}

/** Bank details label by label, each value with its own copy button. */
function BankDetails({ details }: { details: Record<string, string> }) {
  const t = useTranslations('invoicing.public');
  return (
    <dl className="divide-y divide-border rounded-md border border-border text-sm">
      {Object.entries(details).map(([label, value]) => (
        <div
          key={label}
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2"
        >
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground" dir="auto">
              {label}
            </dt>
            <dd className="break-all font-medium" dir="auto">
              {value}
            </dd>
          </div>
          <CopyButton text={value} label={t('copyValue', { label })} compact />
        </div>
      ))}
    </dl>
  );
}

function CopyButton({ text, label, compact }: { text: string; label: string; compact?: boolean }) {
  const t = useTranslations('invoicing.public');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const h = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(h);
  }, [copied]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Button
      variant="secondary"
      size={compact ? 'sm' : undefined}
      className="min-h-10 shrink-0"
      aria-label={label}
      title={label}
      onClick={() => void copy()}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {compact ? (copied ? t('copied') : null) : copied ? t('copied') : label}
    </Button>
  );
}

function Amount({ value }: { value: string }) {
  return (
    <span dir="ltr" className="font-semibold tabular-nums text-foreground">
      {value}
    </span>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh bg-muted/40 px-3 py-6 sm:px-6 sm:py-10">{children}</main>;
}
