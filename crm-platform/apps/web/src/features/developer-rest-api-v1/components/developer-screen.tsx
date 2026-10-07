'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { API_KEY_NAME_MAX, PLAN_UPGRADE_PATH, type ApiKeyResponse } from '@crm/contracts';
import { Alert, Button, ConfirmDialog, Field, Input, Spinner, cn, useToast } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { keysApi, refresh, useKeys } from '../api/keys';
import {
  BACK_PATH,
  DOCS_PATH,
  activeKeys,
  afterRevoke,
  checkName,
  dateLabel,
  errorKind,
  nameFieldError,
  quickstartCurl,
  relativeTime,
  type KeyErrorKind,
  type OneTimeKey,
} from '../lib/keys-model';
import { CopyButton } from './copy-button';
import {
  AlertIcon,
  ArrowIcon,
  BackIcon,
  CheckIcon,
  CodeIcon,
  DocIcon,
  InfoIcon,
  KeyIcon,
  PlusIcon,
  TrashIcon,
} from './icons';

const CARD = 'rounded-2xl border border-border bg-background shadow-sm';
const EYEBROW = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';
const CODE_DARK = 'rounded-lg bg-foreground font-mono text-background';

/** A failed call the screen shows as the red notice. `text` overrides the translated message (the plan-limit sentence from the API). */
export interface Notice {
  kind: KeyErrorKind;
  text?: string;
  requestId?: string;
}

/**
 * `/developers` (TW-API-001 to 004, 010, 151): the reference rail, the title row, the one-time key banner, the live key (with a
 * confirmed revoke) or the create form, and the quickstart. The raw key lives in this component's state only.
 */
export function DeveloperScreen({ baseUrl }: { baseUrl: string }) {
  const t = useTranslations('developer-rest-api-v1.page');
  const canRead = useCan('api.keys.read');
  const canCreate = useCan('api.keys.create');
  const canRevoke = useCan('api.keys.revoke');
  const brand = useSession().org.name;
  const q = useKeys(canRead);
  const [shown, setShown] = useState<OneTimeKey | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [planLocked, setPlanLocked] = useState(false);

  const keys = activeKeys(q.data?.data ?? []);
  const active = keys.length > 0;
  const curlKey = shown?.secret;

  return (
    <div className="mx-auto grid max-w-[1300px] gap-6 p-4 sm:p-6 lg:grid-cols-[260px_1fr]">
      <Rail baseUrl={baseUrl} active={active} known={q.isSuccess} />

      <section className="min-w-0 space-y-5">
        <TitleRow />

        {!canRead ? (
          <Alert tone="danger">
            <p className="font-semibold">{t('forbidden.title')}</p>
            <p>{t('forbidden.body')}</p>
          </Alert>
        ) : (
          <>
            {notice && <NoticeBox notice={notice} />}
            {shown && <OneTimeBanner secret={shown.secret} />}

            {q.isPending ? (
              <div className={cn(CARD, 'flex justify-center p-10')}>
                <Spinner label={t('loading')} />
              </div>
            ) : q.isError ? (
              <LoadFailed error={q.error} onRetry={() => void q.refetch()} />
            ) : active ? (
              keys.map((k) => (
                <ActiveKeyCard
                  key={k.id}
                  apiKey={k}
                  canRevoke={canRevoke}
                  onRevoked={(id) => {
                    setShown((s) => afterRevoke(s, id));
                    setNotice(null);
                  }}
                  onFailed={setNotice}
                />
              ))
            ) : (
              <CreateKeyCard
                canCreate={canCreate}
                planLocked={planLocked}
                onCreated={(created) => {
                  setNotice(null);
                  setShown({ keyId: created.key.id, secret: created.secret });
                }}
                onFailed={(n) => {
                  setNotice(n);
                  if (n.kind === 'planLocked') setPlanLocked(true);
                }}
              />
            )}
          </>
        )}

        <Quickstart baseUrl={baseUrl} brand={brand} apiKey={curlKey} />
      </section>
    </div>
  );
}

function Rail({ baseUrl, active, known }: { baseUrl: string; active: boolean; known: boolean }) {
  const t = useTranslations('developer-rest-api-v1.rail');
  const c = useTranslations('developer-rest-api-v1.common');
  return (
    <aside className="space-y-3">
      <div className={cn(CARD, 'p-4')}>
        <div className="mb-3 grid size-12 place-items-center rounded-xl bg-brand/10 text-brand">
          <CodeIcon className="size-7" />
        </div>
        <div className="text-lg font-semibold leading-tight">{t('name')}</div>
        <div className={cn(EYEBROW, 'mt-1')}>{t('tagline')}</div>
        {known && (
          <div
            className={cn(
              'mt-3 inline-flex items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-[10px]',
              active
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border bg-muted text-foreground',
            )}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                active ? 'bg-success' : 'bg-muted-foreground/50',
              )}
            />
            {active ? t('keyActive') : t('noKey')}
          </div>
        )}
      </div>

      <div className={cn(CARD, 'p-4')}>
        <div className={cn(EYEBROW, 'mb-2')}>{t('baseUrl')}</div>
        <div className="flex items-center gap-1.5">
          <code
            dir="ltr"
            className="min-w-0 flex-1 truncate rounded-lg border border-border bg-muted px-2.5 py-1.5 font-mono text-[11.5px]"
          >
            {baseUrl}
          </code>
          <CopyButton
            text={baseUrl}
            label={c('copy')}
            copiedLabel={c('copied')}
            failedLabel={c('copyFailed')}
            className="size-8 rounded-lg border border-border bg-background text-muted-foreground hover:bg-muted"
          />
        </div>
        <div className={cn(EYEBROW, 'mb-1.5 mt-3')}>{t('authHeader')}</div>
        <code
          dir="ltr"
          className={cn(
            CODE_DARK,
            'block overflow-x-auto whitespace-nowrap px-2.5 py-1.5 text-[11px]',
          )}
        >
          Authorization: Bearer &lt;key&gt;
        </code>
      </div>

      <div className="rounded-2xl border border-brand/30 bg-brand/5 p-4 text-xs leading-relaxed">
        <div className="mb-1 flex items-center gap-2 font-semibold">
          <span className="size-2 rounded-full bg-brand" />
          {t('help.title')}
        </div>
        {t('help.body')}{' '}
        <Link
          href={DOCS_PATH}
          className="inline-flex min-h-6 items-center font-semibold text-brand underline"
        >
          {t('help.link')}
        </Link>
        .
      </div>
    </aside>
  );
}

function TitleRow() {
  const t = useTranslations('developer-rest-api-v1.page');
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <nav aria-label={t('crumbLabel')} className={cn(EYEBROW, 'mb-2')}>
          <Link href={BACK_PATH} className="inline-flex min-h-6 items-center hover:text-brand">
            {t('crumbSettings')}
          </Link>
          <span className="mx-1.5 opacity-60">/</span>
          <span aria-current="page" className="inline-flex min-h-6 items-center">
            {t('crumbHere')}
          </span>
        </nav>
        <h1 className="text-3xl font-semibold leading-none tracking-tight lg:text-4xl">
          {t('title')} <span className="text-brand">{t('titleAccent')}</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('lead')}</p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={BACK_PATH}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <BackIcon className="size-3.5" />
          {t('back')}
        </Link>
        <a
          href={DOCS_PATH}
          target="_blank"
          rel="noopener"
          className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-xs font-semibold text-brand-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <DocIcon className="size-3.5" />
          {t('openDocs')}
        </a>
      </div>
    </div>
  );
}

/** A failed call as the red notice (Reference's flash error). The plan-limit sentence is the server's own, in `detail`. */
export function NoticeBox({ notice }: { notice: Notice }) {
  const t = useTranslations('developer-rest-api-v1.errors');
  const text = notice.text && notice.kind === 'planLimit' ? notice.text : t(notice.kind);
  return (
    <div
      role="alert"
      className="inline-flex w-full items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-4 py-2.5 text-xs text-danger"
    >
      <AlertIcon className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        <p>{text}</p>
        {notice.kind === 'planLocked' && (
          <Link
            href={PLAN_UPGRADE_PATH}
            className="inline-flex min-h-6 items-center font-semibold underline"
          >
            {t('upgrade')}
          </Link>
        )}
        {notice.requestId && (
          <p className="font-mono text-[10px] opacity-70">
            {t('requestId', { id: notice.requestId })}
          </p>
        )}
      </div>
    </div>
  );
}

export function toNotice(e: unknown): Notice {
  const kind = errorKind(e);
  const api = e as { message?: string; requestId?: string };
  return { kind, text: api?.message, requestId: api?.requestId };
}

function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useTranslations('developer-rest-api-v1.errors');
  const kind = errorKind(error);
  const n = toNotice(error);
  return (
    <Alert tone="danger" className="space-y-2">
      <p>{kind === 'forbidden' ? t('forbidden') : t('loadFailed')}</p>
      {n.requestId && (
        <p className="font-mono text-[10px] opacity-70">{t('requestId', { id: n.requestId })}</p>
      )}
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {t('retry')}
      </Button>
    </Alert>
  );
}

/** The raw key, once. No dismiss, as in Reference: it goes away with the page. */
export function OneTimeBanner({ secret }: { secret: string }) {
  const t = useTranslations('developer-rest-api-v1.banner');
  const c = useTranslations('developer-rest-api-v1.common');
  return (
    <section className="rounded-2xl border border-success/50 bg-success/10 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-success/20 text-success">
          <CheckIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-tight text-success">{t('title')}</h2>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{t('warning')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code
              dir="ltr"
              data-testid="api-key-secret"
              className="min-w-0 flex-1 select-all truncate rounded-lg border border-success/40 bg-background px-3 py-2 font-mono text-[12.5px]"
            >
              {secret}
            </code>
            <CopyButton
              text={secret}
              label={c('copy')}
              copiedLabel={c('copied')}
              failedLabel={c('copyFailed')}
              className="h-9 rounded-full bg-brand px-3.5 text-xs font-semibold text-brand-foreground hover:opacity-90"
            >
              {c('copy')}
            </CopyButton>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The live key and its confirmed revoke. Revoke is hidden-by-disable with a reason for a member who may only read. */
export function ActiveKeyCard({
  apiKey,
  canRevoke,
  onRevoked,
  onFailed,
}: {
  apiKey: ApiKeyResponse;
  canRevoke: boolean;
  onRevoked: (id: string) => void;
  onFailed: (n: Notice) => void;
}) {
  const t = useTranslations('developer-rest-api-v1.key');
  const locale = useLocale();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const last = relativeTime(apiKey.lastUsedAt, locale);

  const revoke = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await keysApi.revoke(apiKey.id);
      onRevoked(apiKey.id);
      toast(t('revoked'), 'success');
    } catch (e) {
      onFailed(toNotice(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
      setConfirming(false);
      // A 404 or a failure may mean the list is stale: show the server's truth either way.
      await refresh(qc);
    }
  };

  return (
    <section className={cn(CARD, 'overflow-hidden')}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-lg font-semibold leading-tight">{t('title')}</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2 py-1 font-mono text-[10px] text-success">
          <span className="size-1.5 rounded-full bg-success" />
          {t('active')}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4 p-5">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          <KeyIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{apiKey.name || t('untitled')}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
            <code dir="ltr" className="text-foreground">
              {apiKey.prefix}…
            </code>
            <span>{t('created', { date: dateLabel(apiKey.createdAt, locale) })}</span>
            <span>{t('lastUsed', { when: last ?? t('never') })}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            disabled={!canRevoke || busy}
            onClick={() => setConfirming(true)}
            title={canRevoke ? undefined : t('noRevoke')}
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-background px-3.5 text-xs font-medium transition hover:border-danger hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <TrashIcon className="size-3.5" />
            {t('revoke')}
          </button>
          {!canRevoke && <p className="text-[11px] text-muted-foreground">{t('noRevoke')}</p>}
        </div>
      </div>
      <div className="flex w-full items-center gap-1.5 border-t border-border bg-muted/50 px-5 py-2.5 text-[11.5px] text-muted-foreground">
        <InfoIcon className="size-3.5 shrink-0" />
        {t('footer')}
      </div>
      <ConfirmDialog
        open={confirming}
        title={t('confirm.title')}
        message={t('confirm.message')}
        confirmLabel={t('confirm.accept')}
        cancelLabel={t('confirm.cancel')}
        tone="danger"
        busy={busy}
        onConfirm={() => void revoke()}
        onClose={() => setConfirming(false)}
      />
    </section>
  );
}

/** The "Create your key" card: one name field, 1 to 120 characters, one submit at a time. */
export function CreateKeyCard({
  canCreate,
  planLocked,
  onCreated,
  onFailed,
}: {
  canCreate: boolean;
  planLocked: boolean;
  onCreated: (created: Awaited<ReturnType<typeof keysApi.create>>) => void;
  onFailed: (n: Notice) => void;
}) {
  const t = useTranslations('developer-rest-api-v1.create');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const disabled = !canCreate || planLocked;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current || disabled) return;
    const check = checkName(name);
    if (!check.ok) {
      setError(t(`errors.${check.error}`));
      return;
    }
    setError(null);
    inFlight.current = true;
    setBusy(true);
    try {
      const created = await keysApi.create({ name: check.name });
      setName('');
      onCreated(created);
      toast(t('created'), 'success');
    } catch (err) {
      const inline = errorKind(err) === 'validation' ? nameFieldError(err) : null;
      if (inline) setError(inline);
      else onFailed(toNotice(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
      // The list is the truth: after a plan-limit refusal or a created key it shows the live key.
      await refresh(qc);
    }
  };

  return (
    <section className={cn(CARD, 'p-5')}>
      <h2 className="text-lg font-semibold leading-tight">{t('title')}</h2>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">{t('help')}</p>
      <form
        onSubmit={(e) => void submit(e)}
        noValidate
        className="mt-4 flex flex-wrap items-start gap-2"
      >
        <Field
          label={t('name')}
          htmlFor="key-name"
          eyebrow
          error={error}
          className="min-w-[220px] flex-1"
        >
          <Input
            id="key-name"
            name="name"
            type="text"
            required
            maxLength={API_KEY_NAME_MAX}
            placeholder={t('placeholder')}
            value={name}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
        <Button
          type="submit"
          variant="brand"
          disabled={disabled || busy}
          aria-busy={busy || undefined}
          className="mt-5 rounded-full"
        >
          {busy ? <Spinner /> : <PlusIcon className="size-3.5" />}
          {busy ? t('submitting') : t('submit')}
        </Button>
      </form>
      {!canCreate && <p className="mt-3 text-xs text-muted-foreground">{t('noCreate')}</p>}
      {canCreate && planLocked && (
        <p className="mt-3 text-xs text-muted-foreground">{t('planLocked')}</p>
      )}
    </section>
  );
}

/** The first request, ready to paste. It carries the real key only while the one-time banner is up; otherwise YOUR_API_KEY. */
export function Quickstart({
  baseUrl,
  brand,
  apiKey,
}: {
  baseUrl: string;
  brand: string;
  apiKey?: string;
}) {
  const t = useTranslations('developer-rest-api-v1.quickstart');
  const curl = quickstartCurl(baseUrl, brand, apiKey);
  return (
    <section className={cn(CARD, 'p-5')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold leading-tight">{t('title')}</h2>
        <a
          href={DOCS_PATH}
          target="_blank"
          rel="noopener"
          className="inline-flex min-h-6 items-center gap-1.5 text-xs font-semibold text-brand hover:underline"
        >
          {t('reference')}
          <ArrowIcon className="size-3" />
        </a>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('intro')}</p>
      <pre
        dir="ltr"
        tabIndex={0}
        aria-label={t('title')}
        data-testid="quickstart-curl"
        className="mt-3 overflow-x-auto rounded-xl bg-foreground px-4 py-3 font-mono text-xs leading-relaxed text-background"
      >
        {curl}
      </pre>
    </section>
  );
}
