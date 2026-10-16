import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { CopyButton } from '../../components/copy-button';
import { CheckIcon, CodeIcon, KeyIcon } from '../../components/icons';
import { PLACEHOLDER_KEY } from '../../lib/keys-model';
import { RATE_LIMIT_DEFAULT_PER_MINUTE } from '../lib/constants';

export const CARD = 'rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-6';
export const EYEBROW = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';
const CODE =
  'overflow-x-auto rounded-lg bg-foreground p-4 font-mono text-xs leading-relaxed text-background';
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
const BTN = cn(
  'inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-xs font-semibold transition hover:border-brand',
  FOCUS,
);

/** A dark code box with a copy button in its corner. The text is always left-to-right (it is code), whatever the page direction. */
export function CodeBlock({ text, copyLabel }: { text: string; copyLabel: string }) {
  const c = useTranslations('developer-rest-api-v1-docs.common');
  return (
    <div className="relative">
      <CopyButton
        text={text}
        label={copyLabel}
        copiedLabel={c('copied')}
        failedLabel={c('copyFailed')}
        className="absolute end-2 top-2 rounded-md bg-background/15 p-1.5 text-background hover:bg-background/30"
      />
      <pre dir="ltr" className={cn(CODE, 'pe-12 text-start')}>
        {text}
      </pre>
    </div>
  );
}

export function Topbar({ brand, specUrl }: { brand: string; specUrl: string }) {
  const t = useTranslations('developer-rest-api-v1-docs.topbar');
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur sm:px-6">
      <Link
        href="/"
        aria-label={t('home', { brand })}
        className={cn('flex min-w-0 items-center gap-2.5 rounded-lg', FOCUS)}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand text-brand-foreground">
          <CodeIcon className="size-5" />
        </span>
        <span className="truncate text-lg font-semibold leading-none">
          {brand} <em className="font-semibold text-brand">{t('apiWord')}</em>
        </span>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[10px] tracking-wider text-brand">
          {t('version')}
        </span>
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        <a
          href={specUrl}
          target="_blank"
          rel="noopener"
          className={cn(BTN, 'hidden sm:inline-flex')}
        >
          {t('spec')}
        </a>
        <Link
          href="/developers"
          className={cn(BTN, 'border-brand bg-brand text-brand-foreground hover:opacity-90')}
        >
          <KeyIcon className="size-3.5" />
          {t('getKey')}
        </Link>
      </div>
    </header>
  );
}

export function Hero({ brand, baseUrl }: { brand: string; baseUrl: string }) {
  const t = useTranslations('developer-rest-api-v1-docs.hero');
  const c = useTranslations('developer-rest-api-v1-docs.common');
  return (
    <section id="intro" className="mb-10 scroll-mt-20">
      <div className={cn(EYEBROW, 'mb-2.5 text-[11px]')}>{t('eyebrow')}</div>
      <h1 className="mb-3.5 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
        {t.rich('title', { brand, em: (chunks) => <em className="text-brand">{chunks}</em> })}
      </h1>
      <p className="mb-5 max-w-2xl text-[15px] text-muted-foreground">{t('lead')}</p>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[11px]">
          <span className="size-1.5 rounded-full bg-success" aria-hidden />
          {t('baseUrl')}
        </span>
        <div className="flex min-w-[260px] flex-1 items-center gap-2.5 rounded-lg bg-foreground px-3.5 py-2.5 text-background">
          <code
            dir="ltr"
            className="flex-1 overflow-x-auto whitespace-nowrap text-start font-mono text-[12.5px]"
          >
            {baseUrl}
          </code>
          <CopyButton
            text={baseUrl}
            label={t('copyBaseUrl')}
            copiedLabel={c('copied')}
            failedLabel={c('copyFailed')}
            className="rounded-md bg-background/15 p-1.5 hover:bg-background/30"
          />
        </div>
      </div>
    </section>
  );
}

const CAPABILITIES = [
  'send',
  'receive',
  'contacts',
  'templates',
  'flows',
  'status',
  'devices',
  'account',
] as const;

export function Capabilities() {
  const t = useTranslations('developer-rest-api-v1-docs.capabilities');
  return (
    <section className={cn(CARD, 'mb-5')} aria-labelledby="caps-title">
      <h2 id="caps-title" className="mb-3 text-xl font-semibold">
        {t('title')}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CAPABILITIES.map((k) => (
          <li key={k} className="rounded-xl border border-border bg-muted p-3.5">
            <div className="flex items-center gap-2 text-[13px] font-bold">
              <CheckIcon className="size-4 shrink-0 text-brand" />
              {t(`${k}.title`)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{t(`${k}.body`)}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const CODE_CHIP = 'rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground';
const richTags = {
  strong: (c: React.ReactNode) => <strong className="text-foreground">{c}</strong>,
  code: (c: React.ReactNode) => <code className={CODE_CHIP}>{c}</code>,
};

export function AuthCard() {
  const t = useTranslations('developer-rest-api-v1-docs.auth');
  const header = `Authorization: Bearer ${PLACEHOLDER_KEY}`;
  return (
    <section id="auth" className={cn(CARD, 'mb-5 scroll-mt-20')} aria-labelledby="auth-title">
      <h2 id="auth-title" className="mb-1.5 text-xl font-semibold">
        {t('title')}
      </h2>
      <p className="mb-3 text-muted-foreground">{t.rich('intro', richTags)}</p>
      <CodeBlock text={header} copyLabel={t('copyHeader')} />
      <p className="mt-3 text-muted-foreground">{t.rich('alt', richTags)}</p>
    </section>
  );
}

/**
 * The Webhooks card. Webhook delivery is not built yet (it waits on the integrations domain), so the card says so instead of listing
 * events nobody can receive; Reference's twelve-event grid comes back when delivery does. The rate-limit line states the real default.
 */
export function WebhooksCard() {
  const t = useTranslations('developer-rest-api-v1-docs.webhooks');
  return (
    <section
      id="webhooks-info"
      className={cn(CARD, 'mb-5 scroll-mt-20')}
      aria-labelledby="webhooks-title"
    >
      <h2 id="webhooks-title" className="mb-3 text-xl font-semibold">
        {t('title')}
      </h2>
      <div role="note" className="rounded-xl border border-border bg-muted p-4">
        <p className="text-sm font-bold">{t('comingTitle')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('comingBody')}</p>
      </div>
      <p className="mt-3.5 text-muted-foreground">
        <span className="me-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[11px] text-foreground">
          <span className="size-1.5 rounded-full bg-success" aria-hidden />
          {t('rateLabel')}
        </span>
        {t.rich('rate', { ...richTags, limit: RATE_LIMIT_DEFAULT_PER_MINUTE })}
      </p>
    </section>
  );
}

export function Footer({ brand }: { brand: string }) {
  const t = useTranslations('developer-rest-api-v1-docs');
  return (
    <p className="mt-12 text-center text-xs text-muted-foreground">{t('footer', { brand })}</p>
  );
}
