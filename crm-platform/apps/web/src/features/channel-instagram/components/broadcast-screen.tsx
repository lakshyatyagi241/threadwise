'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@crm/ui';
import { IG_SEND_MAX, type IgSendResult } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { sendBroadcast, useCompose } from '../api/instagram';
import {
  MESSAGE_MAX,
  NAME_MAX,
  canSend,
  exceedsCap,
  filterThreads,
  openCount,
  outcomeOf,
  prefill,
  selectAll,
  toggle,
} from '../lib/broadcast-model';

/**
 * `/instagram/broadcast` (TW-IG-013, 014): a reply-only broadcast. Instagram only lets an account message people who already wrote
 * to it, so the recipients are existing conversations of one linked account. The 24 hour window is enforced by Instagram when each
 * message is sent; the list shows whose window is open so a plain message is known to reach them. `{name}` becomes the person's name.
 */
export function BroadcastScreen() {
  const t = useTranslations('instagram.broadcast');
  // The quiet-hours wording is shared with the other senders (BL-177); it lives with the Compliance center.
  const tHold = useTranslations('compliance-center.hold');
  const compose = useCompose();
  const [chosenAccount, setChosenAccount] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IgSendResult | null>(null);

  const accounts = compose.data?.accounts ?? [];
  const templates = compose.data?.templates ?? [];
  const account = accounts.find((a) => a.id === chosenAccount) ?? accounts[0];
  const threads = account ? (compose.data?.threads[account.instaflowAccountId] ?? []) : [];
  const shown = filterThreads(threads, query);

  const send = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await sendBroadcast({
        name: name.trim(),
        message: message.trim(),
        threadIds: [...picked],
      });
      setResult(res);
      if (res.sent > 0 || res.held > 0) {
        setPicked(new Set());
        setMessage('');
        setName('');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
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
        <Link
          href="/instagram"
          className="inline-flex h-9 shrink-0 items-center rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted"
        >
          {t('accounts')}
        </Link>
      </div>

      {compose.isError && <Alert tone="danger">{t('loadError')}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {result &&
        outcomeOf(result) !== 'held' &&
        (outcomeOf(result) === 'none' ? (
          <Alert tone="danger">{t('sentNone')}</Alert>
        ) : (
          <Alert tone={outcomeOf(result) === 'all' ? 'success' : 'info'}>
            {t('sent', { sent: result.sent, failed: result.failed })}
          </Alert>
        ))}
      {result && result.held > 0 && (
        <Alert tone="info">
          <span data-testid="broadcast-held">
            {tHold('heldCount', { count: result.held })}
            {result.heldUntil
              ? ` · ${tHold('heldUntil', { when: new Date(result.heldUntil).toLocaleString() })}`
              : ''}
          </span>
        </Alert>
      )}
      {result && result.errors.length > 0 && (
        <ul className="space-y-0.5 text-[11.5px] text-danger">
          {result.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {compose.isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : accounts.length === 0 ? (
        <Alert tone="info">
          {t('noAccounts')}{' '}
          <Link href="/instagram" className="font-medium underline">
            {t('accounts')}
          </Link>
        </Alert>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <form
            className="space-y-4 rounded-2xl border border-border bg-background p-5 shadow-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <Field label={t('name')} htmlFor="ig-bcast-name">
              <Input
                id="ig-bcast-name"
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
              />
            </Field>
            {accounts.length > 1 && (
              <Field label={t('account')} htmlFor="ig-bcast-account">
                <Select
                  id="ig-bcast-account"
                  value={account?.id ?? ''}
                  onChange={(e) => {
                    setChosenAccount(e.target.value);
                    setPicked(new Set());
                  }}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.handle}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {templates.length > 0 && (
              <Field label={t('template')} htmlFor="ig-bcast-template" hint={t('templateHint')}>
                <Select
                  id="ig-bcast-template"
                  value={templateId}
                  onChange={(e) => {
                    setTemplateId(e.target.value);
                    const tpl = templates.find((x) => x.id === e.target.value);
                    if (tpl) setMessage((m) => prefill(m, tpl.body));
                  }}
                >
                  <option value="">{t('templateNone')}</option>
                  {templates.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field
              label={t('message')}
              htmlFor="ig-bcast-message"
              hint={t('messageHint', { token: '{name}', max: MESSAGE_MAX })}
            >
              <Textarea
                id="ig-bcast-message"
                rows={5}
                maxLength={MESSAGE_MAX}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('messagePlaceholder', { token: '{name}' })}
                className="resize-y"
              />
            </Field>
            <Button
              type="submit"
              className="w-full rounded-full"
              disabled={!canSend({ name, message, picked: picked.size, busy })}
            >
              {busy ? t('sending') : t('send', { count: picked.size })}
            </Button>
          </form>

          <section className="rounded-2xl border border-border bg-background p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[13px] font-semibold">{t('recipients')}</div>
              <div className="font-mono text-[11px] text-muted-foreground">
                {t('windowOpenCount', { open: openCount(threads), total: threads.length })}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('search')}
                aria-label={t('search')}
                className="min-w-0 flex-1"
              />
              <button
                type="button"
                className="h-9 rounded-full border border-border px-3 text-xs font-medium hover:bg-muted"
                onClick={() => setPicked(selectAll(shown))}
              >
                {t('selectAll')}
              </button>
              <button
                type="button"
                className="h-9 rounded-full border border-border px-3 text-xs font-medium hover:bg-muted"
                onClick={() => setPicked(new Set())}
              >
                {t('clear')}
              </button>
            </div>
            {exceedsCap(shown) && (
              <p className="mt-2 text-[11px] text-warning">{t('capNote', { max: IG_SEND_MAX })}</p>
            )}

            {threads.length === 0 ? (
              <p className="mt-6 text-center text-xs text-muted-foreground">{t('empty')}</p>
            ) : (
              <ul className="mt-3 max-h-[28rem] divide-y divide-border overflow-y-auto rounded-xl border border-border">
                {shown.map((th) => (
                  <li key={th.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/60">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--brand)]"
                        checked={picked.has(th.id)}
                        onChange={() => setPicked((p) => toggle(p, th.id))}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{th.title}</span>
                      <span
                        className={
                          th.windowOpen
                            ? 'shrink-0 rounded-full bg-success/10 px-2 py-0.5 font-mono text-[10.5px] text-success'
                            : 'shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground'
                        }
                      >
                        {th.windowOpen ? t('inWindow') : t('outsideWindow')}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 text-[10.5px] text-muted-foreground">
              {t('selected', { count: picked.size })}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
