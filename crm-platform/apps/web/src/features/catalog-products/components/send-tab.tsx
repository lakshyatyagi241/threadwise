'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, Select, Spinner, Textarea, cn } from '@crm/ui';
import {
  CATALOG_SEND_MAX_PRODUCTS,
  CATALOG_SEND_MODES,
  type CatalogSendMode,
  type SendCatalogResponse,
} from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, sendCatalog, useOverview, useSendOptions } from '../api/catalog';
import { providerLabel, timeAgo } from '../lib/format';
import {
  EMPTY_SEND_FORM,
  FOOTER_MAX,
  HEADER_MAX,
  MESSAGE_MAX,
  SEND_LABEL,
  buildSendRequest,
  firstId,
  firstKey,
  recipientCount,
  sendFailed,
  setMode,
  toggleProduct,
  type SendForm,
} from '../lib/send-model';
import { ChatIcon, SendIcon } from './icons';
import { CARD, KICKER, LoadError, LoadingBlock, PILL_LINK, StepBadge, TEXT_LINK } from './parts';
import { ProductsStep } from './send-products';
import { RecipientsStep } from './send-recipients';
import { SenderSelect } from './sender-select';
import { useErrorText } from './use-error-text';

type Feedback =
  | { kind: 'ok' | 'err'; text: string; errors: string[] }
  | { kind: 'warn'; text: string; errors: [] };

/** The Send tab with no connected sender (WD-CAT-014): a catalog message needs a device first. */
function NoSender() {
  const t = useTranslations('catalogProducts.send');
  return (
    <div className={cn(CARD, 'flex items-start gap-5 p-6')}>
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-muted text-brand dark:text-primary">
        <ChatIcon className="size-6" />
      </span>
      <div className="flex-1">
        <div className="font-serif text-[22px] leading-tight">{t('noSender.title')}</div>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">{t('noSender.message')}</p>
        <Link href="/channels" className={`${PILL_LINK} mt-3`}>
          {t('noSender.connect')}
        </Link>
      </div>
    </div>
  );
}

/**
 * The Send tab (WD-CAT-014, 015): four steps (recipients, format and sender, products, message) and a side rail. Sending is one
 * request; the server answers with how many went out and the first reasons the others did not.
 */
export function SendTab() {
  const t = useTranslations('catalogProducts.send');
  const errorText = useErrorText();
  const locale = useLocale();
  const qc = useQueryClient();
  const canSend = useCan('cat.catalog.send');
  const options = useSendOptions();
  const overview = useOverview();

  const [form, setForm] = useState<SendForm>(EMPTY_SEND_FORM);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const patch = (p: Partial<SendForm>) => setForm((f) => ({ ...f, ...p }));

  const data = options.data;
  const groupCounts = useMemo(
    () => new Map((data?.groups ?? []).map((g) => [g.id, g.count])),
    [data?.groups],
  );

  if (options.isPending) return <LoadingBlock label={t('loading')} />;
  if (options.isError || !data) {
    return (
      <LoadError
        error={options.error}
        title={t('loadError')}
        onRetry={() => void options.refetch()}
      />
    );
  }
  if (!data.connected || data.senders.length === 0) return <NoSender />;

  const sender = form.sender || firstKey(data.senders);
  const shop = data.shops.length > 0 ? form.shopId || firstId(data.shops) : '';
  const count = recipientCount(form, groupCounts);
  const catalog = overview.data?.catalog ?? null;

  const onToggleProduct = (id: string) => {
    const out = toggleProduct(form, id);
    setForm(out.form);
    if (out.refused === 'max')
      setFeedback({
        kind: 'warn',
        text: t('maxProducts', { max: CATALOG_SEND_MAX_PRODUCTS }),
        errors: [],
      });
  };

  const send = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const res: SendCatalogResponse = await sendCatalog(
        buildSendRequest({ ...form, sender, shopId: shop }),
      );
      setFeedback(
        sendFailed(res)
          ? { kind: 'err', text: t('feedback.failed'), errors: res.errors }
          : {
              kind: 'ok',
              text: `${t('feedback.sent', { count: res.sent })}${res.failed > 0 ? ` · ${t('feedback.someFailed', { count: res.failed })}` : ''}`,
              errors: res.errors,
            },
      );
      void qc.invalidateQueries({ queryKey: KEYS.activity });
      void qc.invalidateQueries({ queryKey: KEYS.sendOptions });
      void qc.invalidateQueries({ queryKey: KEYS.overview });
    } catch (e) {
      setFeedback({ kind: 'err', text: errorText(e), errors: [] });
    } finally {
      setBusy(false);
    }
  };

  const modeTile = (mode: CatalogSendMode) => (
    <label key={mode} className="relative block cursor-pointer">
      <input
        type="radio"
        name="mode"
        value={mode}
        checked={form.mode === mode}
        onChange={() => setForm((f) => setMode(f, mode))}
        className="peer sr-only"
      />
      <span className="block rounded-xl border border-border p-3 transition peer-checked:border-brand peer-checked:bg-muted peer-checked:ring-2 peer-checked:ring-brand/20 peer-focus-visible:ring-2 peer-focus-visible:ring-primary">
        <span className="block text-[13px] font-semibold">{t(`format.${mode}.title`)}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {t(`format.${mode}.hint`)}
        </span>
      </span>
    </label>
  );

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-5">
        <RecipientsStep
          form={form}
          options={data}
          count={count}
          patch={patch}
          onCapReached={() =>
            setFeedback({ kind: 'warn', text: t('recipients.overCap', { max: 500 }), errors: [] })
          }
        />

        <section className={cn(CARD, 'p-5')} aria-labelledby="cat-send-format">
          <div className="mb-4 flex items-center gap-2.5">
            <StepBadge n="02" />
            <h3
              id="cat-send-format"
              className="flex-1 font-serif text-[18px] font-normal leading-none"
            >
              {t('format.title')}
            </h3>
          </div>
          <div
            role="radiogroup"
            aria-label={t('format.title')}
            className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3"
          >
            {CATALOG_SEND_MODES.map(modeTile)}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('format.sendFrom')} htmlFor="cat-send-from">
              <SenderSelect
                id="cat-send-from"
                senders={data.senders}
                value={sender}
                onChange={(key) => patch({ sender: key })}
              />
            </Field>
            {data.shops.length > 0 && (
              <Field
                label={
                  <>
                    {t('format.fromShop')}{' '}
                    <span className="font-normal text-muted-foreground">
                      {t('format.brandingContext')}
                    </span>
                  </>
                }
                htmlFor="cat-send-shop"
              >
                <Select
                  id="cat-send-shop"
                  value={shop}
                  onChange={(e) => patch({ shopId: e.target.value })}
                >
                  {data.shops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.shopName || t('format.shopFallback', { slug: s.slug })}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </section>

        {form.mode !== 'link' && (
          <ProductsStep form={form} shop={shop} shops={data.shops} onToggle={onToggleProduct} />
        )}

        <section className={cn(CARD, 'space-y-3 p-5')} aria-labelledby="cat-send-message">
          <div className="mb-1 flex items-center gap-2.5">
            <StepBadge n="04" />
            <h3
              id="cat-send-message"
              className="flex-1 font-serif text-[18px] font-normal leading-none"
            >
              {t('message.title')}
            </h3>
          </div>
          {form.mode === 'mpm' && (
            <Field
              label={
                <>
                  {t('message.header')}{' '}
                  <span className="font-normal text-muted-foreground">{t('message.optional')}</span>
                </>
              }
              htmlFor="cat-send-header"
              hint={t('message.counter', { used: form.header.length, max: HEADER_MAX })}
            >
              <Input
                id="cat-send-header"
                value={form.header}
                maxLength={HEADER_MAX}
                onChange={(e) => patch({ header: e.target.value })}
                placeholder={t('message.headerPlaceholder')}
                className="text-[13px]"
              />
            </Field>
          )}
          <Field
            label={
              <>
                {t('message.text')}{' '}
                <span className="font-normal text-muted-foreground">{t('message.optional')}</span>
              </>
            }
            htmlFor="cat-send-body"
            hint={t('message.counter', { used: form.body.length, max: MESSAGE_MAX })}
          >
            <Textarea
              id="cat-send-body"
              rows={2}
              value={form.body}
              maxLength={MESSAGE_MAX}
              onChange={(e) => patch({ body: e.target.value })}
              placeholder={t('message.placeholder')}
              className="text-[13px]"
            />
          </Field>

          {form.mode !== 'link' && (
            <Field
              label={
                <>
                  {t('message.footer')}{' '}
                  <span className="font-normal text-muted-foreground">{t('message.optional')}</span>
                </>
              }
              htmlFor="cat-send-footer"
              hint={t('message.counter', { used: form.footer.length, max: FOOTER_MAX })}
            >
              <Input
                id="cat-send-footer"
                value={form.footer}
                maxLength={FOOTER_MAX}
                onChange={(e) => patch({ footer: e.target.value })}
                placeholder={t('message.footerPlaceholder')}
                className="text-[13px]"
              />
            </Field>
          )}

          {feedback && (
            <div
              role={feedback.kind === 'err' ? 'alert' : 'status'}
              className={cn(
                'rounded-lg border px-3 py-2 font-mono text-[12px]',
                feedback.kind === 'ok' && 'border-success/40 bg-success/10 text-success',
                feedback.kind === 'err' && 'border-danger/40 bg-danger/10 text-danger',
                feedback.kind === 'warn' && 'border-warning/40 bg-warning/15 text-warning',
              )}
            >
              <div>
                {feedback.kind === 'ok' ? '✓ ' : feedback.kind === 'err' ? '✗ ' : ''}
                {feedback.text}
              </div>
              {feedback.errors.length > 0 && (
                <ul className="mt-1.5 list-disc space-y-0.5 ps-5 text-[11px]">
                  {feedback.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Link href="/catalog/activity" className={cn(TEXT_LINK, 'me-auto text-[11.5px]')}>
              {t('message.viewRecent')}
            </Link>
            {canSend ? (
              <Button
                variant="brand"
                className="rounded-full px-5 text-[13px]"
                disabled={busy}
                onClick={() => void send()}
              >
                {busy ? <Spinner /> : <SendIcon className="size-3" />}
                {busy ? t('message.sending') : t(`message.${SEND_LABEL[form.mode]}`)}
              </Button>
            ) : (
              <p className="text-[11.5px] text-muted-foreground">{t('message.noPermission')}</p>
            )}
          </div>
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4" aria-label={t('rail.label')}>
        <div className={cn(CARD, 'p-4')}>
          <div className={KICKER}>{t('rail.summary')}</div>
          <dl className="mt-2 space-y-1.5 text-[12.5px]">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('rail.recipients')}</dt>
              <dd className="font-bold tabular-nums">{count.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('rail.products')}</dt>
              <dd className="font-bold tabular-nums">
                {form.mode === 'link' ? '—' : form.productIds.length}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('rail.format')}</dt>
              <dd className="font-bold">{t(`rail.formats.${form.mode}`)}</dd>
            </div>
          </dl>
        </div>

        <div className={cn(CARD, 'p-4')}>
          <div className={`${KICKER} mb-2`}>{t('rail.catalog')}</div>
          {catalog ? (
            <>
              <div className="font-serif text-[15px] leading-tight">
                {catalog.catalogName || t('rail.metaCommerce')}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {providerLabel(catalog.provider)} ·{' '}
                {t('rail.productCount', { count: data.totalProducts })}
              </div>
            </>
          ) : (
            <>
              <div className="font-serif text-[15px] leading-tight">{t('rail.unofficial')}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {t('rail.productCount', { count: data.totalProducts })} ·{' '}
                <Link href="/catalog" className={TEXT_LINK}>
                  {t('rail.linkMeta')}
                </Link>
              </div>
            </>
          )}
        </div>

        {data.recentSends.length > 0 && (
          <div className={cn(CARD, 'p-4')}>
            <div className={`${KICKER} mb-2`}>{t('rail.recent')}</div>
            <ul className="space-y-2">
              {data.recentSends.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-start gap-2 text-[11.5px]">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.recipient || '—'}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {timeAgo(r.createdAt, new Date(), locale)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-2xl border border-success/30 bg-success/10 p-4 text-[11.5px] leading-relaxed">
          <div className="mb-1 font-semibold">{t('rail.windowTitle')}</div>
          <p>{t.rich('rail.windowBody', { b: (chunks) => <b>{chunks}</b> })}</p>
        </div>
      </aside>
    </div>
  );
}
