'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import type { MailboxResponse, MailProvider, MailScope } from '@crm/contracts';
import { Alert, Button, Spinner, useToast } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { KEYS, startConnect, useEmailSettings, useMailboxes, useProviders } from '../api/mailboxes';
import { mailErrorKey } from '../lib/api-errors';
import {
  effectiveScope,
  mailboxAccess,
  orderedProviders,
  providerState,
  scopeRights,
  usageOf,
} from '../lib/hub-model';
import { imapFormFor } from '../lib/imap-form';
import { outcomeFromParam, outcomeView } from '../lib/outcome';
import { ImapConnectDialog, type ImapDialogTarget } from './imap-connect-dialog';
import { MailboxCard } from './mailbox-card';
import { SharingPanel } from './sharing-panel';
import { SignaturesPanel } from './signatures-panel';

const STEPS = ['connect', 'inbox', 'reply', 'limit'] as const;
const GUIDES = ['google', 'other', 'personal', 'consent', 'trouble'] as const;
const POINTS = ['p1', 'p2', 'p3', 'p4'] as const;
const pillLink =
  'inline-flex h-9 items-center rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted';

/**
 * `/email` (TW-MAIL-019, 020, 023, 028, 031, 034, 035): the one screen where a workspace sees its mailboxes, connects another Gmail,
 * Microsoft 365 or IMAP/SMTP account (shared, or personal when the workspace allows it), renames, sets the send limit, syncs,
 * reconnects or removes one, sets the email sharing policy, with the setup guide. Mail itself is read and answered in the inbox.
 */
export function HubScreen() {
  const t = useTranslations('email.hub');
  const g = useTranslations('email.guide');
  const root = useTranslations('email');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const session = useSession();
  const mailboxes = useMailboxes();
  const providers = useProviders();
  const settings = useEmailSettings();
  const canManage = useCan('mail.mailboxes.manage');
  const canPersonal = useCan('mail.mailboxes.manage_personal');
  const canSettings = useCan('mail.settings.manage');
  const [going, setGoing] = useState<string | null>(null);
  const [picked, setPicked] = useState<MailScope>('shared');
  const [imap, setImap] = useState<ImapDialogTarget | null>(null);
  const [outcome, setOutcome] = useState(() => outcomeFromParam(params.get('email')));
  const list = mailboxes.data?.data ?? [];
  const usage = usageOf(mailboxes.data);
  const rights = scopeRights(settings.data, {
    manage: canManage,
    managePersonal: canPersonal,
    isAdmin: canSettings,
  });
  const scope = effectiveScope(picked, rights);
  const cards = orderedProviders(
    providers.isError ? undefined : providers.data?.data,
    mailboxes.data?.providerReady ?? true,
  );
  const viewer = { id: session.user.id, manage: canManage, managePersonal: canPersonal };
  const adminsRead = settings.data?.adminsCanReadPersonal ?? false;
  const connected = list.filter((m) => m.status === 'connected').length;

  // The callback sends the browser back with `?email=<outcome>` (read once into state above): refresh the list, then tidy the address.
  const param = params.get('email');
  useEffect(() => {
    if (param === null) return;
    if (outcomeFromParam(param)) void qc.invalidateQueries({ queryKey: KEYS.all });
    router.replace(pathname, { scroll: false });
  }, [param, pathname, router, qc]);

  const fail = (e: unknown) => {
    const key = e instanceof ApiError ? mailErrorKey(e.code) : null;
    toast(
      key ? root(`errors.${key}`) : e instanceof ApiError ? e.message : t('connectFailed'),
      'danger',
    );
  };

  // A sign-in provider (Google, Microsoft): the sign-in is a page of its own; it returns to /email with the outcome.
  const connectOAuth = async (provider: MailProvider, chosen: MailScope, mailboxId?: string) => {
    setGoing(mailboxId ?? provider);
    try {
      const res = await startConnect({
        provider,
        scope: chosen,
        returnTo: '/email',
        ...(mailboxId ? { mailboxId } : {}),
      });
      window.location.assign(res.authorizeUrl);
    } catch (e) {
      fail(e);
      setGoing(null);
    }
  };

  const reconnect = (m: MailboxResponse) => {
    if (m.provider === 'imap') {
      setImap({ mailboxId: m.id, scope: m.scope, initial: imapFormFor(m) });
    } else {
      void connectOAuth(m.provider, m.scope, m.id);
    }
  };

  const view = outcome ? outcomeView(outcome) : null;

  return (
    <div className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[40px]">
            {t('title')} <span className="italic text-brand">{t('titleAccent')}</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href="/inbox" className={pillLink}>
            {t('inbox')}
          </Link>
          <Link href="/settings/channels" className={pillLink}>
            {t('channels')}
          </Link>
        </div>
      </div>

      {view && outcome && (
        <Alert tone={view.tone} data-testid="email-outcome" data-outcome={outcome}>
          <div className="flex items-start justify-between gap-3">
            <span>{root(`outcome.${view.key}`)}</span>
            <button
              type="button"
              onClick={() => setOutcome(null)}
              className="shrink-0 rounded text-xs underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              {root('common.dismiss')}
            </button>
          </div>
        </Alert>
      )}

      {(mailboxes.isError || mailboxes.failureCount > 0) && (
        <Alert tone="danger">{t('loadError')}</Alert>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-5 lg:sticky lg:top-6">
          <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xl leading-tight">{t('title')}</div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {t('cardCaption')}
                </div>
              </div>
              {connected > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-1 font-mono text-[11px] text-success">
                  <span className="size-1.5 rounded-full bg-success" />
                  {t('connectedCount', { count: connected })}
                </span>
              ) : (
                <span className="rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[11px] text-foreground">
                  {t('notConnected')}
                </span>
              )}
            </div>
            {mailboxes.data && (
              <div className="mt-4" data-testid="email-usage">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t('usageLabel')}</span>
                  <span className="font-mono">
                    {usage.unlimited
                      ? t('usageUnlimited', { used: usage.used })
                      : t('usage', { used: usage.used, limit: usage.limit })}
                  </span>
                </div>
                {!usage.unlimited && (
                  <div
                    role="progressbar"
                    aria-label={t('usageLabel')}
                    aria-valuemin={0}
                    aria-valuemax={usage.limit}
                    aria-valuenow={Math.min(usage.used, usage.limit)}
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className={usage.reached ? 'h-full bg-warning' : 'h-full bg-brand'}
                      style={{ width: `${Math.min(100, (usage.used / usage.limit) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
            <div className="mb-3 text-[13px] font-semibold">{t('howTitle')}</div>
            <ol className="space-y-4">
              {STEPS.map((k, i) => (
                <li key={k} className="flex items-start gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-xl bg-muted font-mono text-xs">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold leading-tight">
                      {t(`how.${k}.title`)}
                    </div>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {t(`how.${k}.body`)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          <section aria-labelledby="email-mailboxes">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="email-mailboxes" className="text-lg leading-tight">
                {t('connectedTitle')}
              </h2>
              <span className="font-mono text-[11px] text-muted-foreground">
                {t('total', { count: list.length })}
              </span>
            </div>
            {mailboxes.isLoading && mailboxes.failureCount === 0 ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : mailboxes.isLoading ? null : list.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-6 text-center">
                <p className="text-sm text-muted-foreground">{t('empty')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {list.map((m) => (
                  <MailboxCard
                    key={m.id}
                    mailbox={m}
                    access={mailboxAccess(m, viewer, adminsRead)}
                    onReconnect={reconnect}
                    reconnecting={going !== null}
                  />
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="email-connect">
            <h2 id="email-connect" className="mb-3 text-lg leading-tight">
              {t('addTitle')}
            </h2>
            {rights.shared && rights.personal ? (
              <fieldset className="mb-4 flex flex-wrap items-start gap-3" data-testid="email-scope">
                <legend className="mb-2 text-xs font-medium text-muted-foreground">
                  {t('scope.title')}
                </legend>
                {(['shared', 'personal'] as const).map((s) => (
                  <label
                    key={s}
                    className="flex max-w-xs cursor-pointer items-start gap-2 rounded-xl border border-border bg-background p-3 text-xs has-[:checked]:border-primary"
                  >
                    <input
                      type="radio"
                      name="email-scope"
                      value={s}
                      checked={picked === s}
                      onChange={() => setPicked(s)}
                      className="mt-0.5 accent-[var(--primary)]"
                    />
                    <span>
                      <span className="block text-[13px] font-semibold">{t(`scope.${s}`)}</span>
                      <span className="text-muted-foreground">{t(`scope.${s}Hint`)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : (
              !rights.shared &&
              rights.personal && (
                <p
                  data-testid="email-scope-personal-only"
                  className="mb-3 text-xs text-muted-foreground"
                >
                  {t('scope.onlyPersonal')}
                </p>
              )
            )}
            {providers.isLoading ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {cards.map((info) => {
                  const state = providerState(info, mailboxes.data, scope !== null);
                  const busy = going === info.provider;
                  return (
                    <div
                      key={info.provider}
                      data-testid={`email-provider-${info.provider}`}
                      data-state={state}
                      className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-4 shadow-sm"
                    >
                      <div>
                        <div className="text-[15px] font-semibold">
                          {t(`providers.${info.provider}.name`)}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t(`providers.${info.provider}.hint`)}
                        </p>
                      </div>
                      <div className="mt-auto space-y-2">
                        <Button
                          className="rounded-full"
                          disabled={state !== 'ready' || going !== null}
                          onClick={() => {
                            if (!scope) return;
                            if (info.kind === 'password') {
                              setImap({ scope });
                            } else {
                              void connectOAuth(info.provider, scope);
                            }
                          }}
                        >
                          {busy && <Spinner />} {t(`connect.${info.provider}`)}
                        </Button>
                        {state === 'not_ready' && (
                          <p
                            data-testid="email-not-ready"
                            role="status"
                            className="text-xs text-warning"
                          >
                            {t('notReady', { provider: t(`providers.${info.provider}.name`) })}
                          </p>
                        )}
                        {state === 'limit' && (
                          <p
                            data-testid="email-limit"
                            role="status"
                            className="text-xs text-warning"
                          >
                            {t('limitReached', { limit: usage.limit })}
                          </p>
                        )}
                        {state === 'no_permission' && (
                          <p role="status" className="text-xs text-muted-foreground">
                            {t('noPermission')}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {canSettings && settings.data && <SharingPanel settings={settings.data} />}
          <SignaturesPanel />

          <section className="space-y-2" aria-labelledby="email-guide">
            <h2 id="email-guide" className="text-lg leading-tight">
              {g('title')}
            </h2>
            {GUIDES.map((k) => (
              <details key={k} className="rounded-xl border border-border bg-background">
                <summary className="cursor-pointer select-none px-4 py-3 text-[13px] font-semibold hover:bg-muted/50">
                  {g(`${k}.title`)}
                </summary>
                <ul className="list-inside list-disc space-y-1.5 border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                  {POINTS.map((p) => (
                    <li key={p}>{g(`${k}.${p}`)}</li>
                  ))}
                </ul>
              </details>
            ))}
          </section>
        </div>
      </div>
      <ImapConnectDialog
        target={imap}
        onClose={() => setImap(null)}
        onConnected={() => {
          const wasReconnect = Boolean(imap?.mailboxId);
          setImap(null);
          toast(t(wasReconnect ? 'imapReconnected' : 'imapConnected'), 'success');
        }}
      />
    </div>
  );
}
