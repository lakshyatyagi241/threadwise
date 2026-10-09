'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useUnofficialWhatsapp } from '@/lib/use-unofficial-whatsapp';
import { Modal, cn } from '@crm/ui';
import { useCommerceProducts } from '../../../api/hooks';
import { Field, SelectInput, TextArea, TextInput, controlClass } from '../kit';
import type { FormComponent, FormProps } from '../types';
import {
  MAX_PRODUCT_ITEMS,
  formatPrice,
  mergePicked,
  readProductItems,
  storeLabel,
  toProductItem,
  withSavedOption,
  type ProductItem,
} from './helpers';
import { ExtLink, Intro, PlusIcon, RemoveButton } from './shared';

const NS = 'flb.builder.formsChannels.commerce';

type Provider = 'whatsapp_shop' | 'woocommerce' | 'shopify';

/**
 * Where each provider's store connection lives. Reference's WooCommerce hint links to `/integrations`; the store connection lives at
 * `/woocommerce` in this app, so the link goes there (intended deviation: the other path is not a page here). The wording of
 * each provider is in the messages under `providers.<provider>`.
 */
const PROVIDER_HREF: Record<Provider, string> = {
  whatsapp_shop: '/catalog',
  woocommerce: '/woocommerce',
  shopify: '/shopify',
};

/** The abandoned-cart wait choices: the saved value (minutes) and the message that words it. */
const WAIT_OPTIONS = [
  { v: '5', key: 'waitMinutes', count: 5 },
  { v: '15', key: 'waitMinutes', count: 15 },
  { v: '60', key: 'waitHours', count: 1 },
  { v: '240', key: 'waitHours', count: 4 },
  { v: '1440', key: 'waitDays', count: 1 },
] as const;

const Thumb = ({ src, className }: { src: string | null; className: string }) =>
  src ? (
    <img src={src} alt="" className={cn('rounded border border-border object-cover', className)} />
  ) : (
    <div
      className={cn(
        'grid place-items-center rounded border border-border bg-muted font-mono text-[9px] text-muted-foreground',
        className,
      )}
    >
      IMG
    </div>
  );

function PickerBody({
  provider,
  storeId,
  already,
  onClose,
  onPicked,
}: {
  provider: Provider;
  storeId: string;
  already: Set<string>;
  onClose: () => void;
  onPicked: (items: ProductItem[]) => void;
}) {
  const t = useTranslations(NS);
  const tc = useTranslations('flb.common');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Record<string, ProductItem>>({});
  const products = useCommerceProducts({ provider, storeId, limit: 100 });
  const list = products.data?.data ?? [];
  const query = q.trim().toLowerCase();
  const filtered = query
    ? list.filter(
        (pr) =>
          pr.name.toLowerCase().includes(query) || (pr.sku ?? '').toLowerCase().includes(query),
      )
    : list;
  const count = Object.keys(picked).length;
  const toggle = (item: ProductItem) =>
    setPicked((cur) => {
      const next = { ...cur };
      if (next[item.retailer_id]) delete next[item.retailer_id];
      else next[item.retailer_id] = item;
      return next;
    });
  return (
    <>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('searchPlaceholder')}
        className={cn(controlClass, 'mb-3')}
      />
      <div className="max-h-[50vh] overflow-y-auto">
        {products.isPending ? (
          <div className="py-12 text-center text-[12.5px] italic text-muted-foreground">
            {t('loadingProducts')}
          </div>
        ) : null}
        {products.isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {t('loadFailed', { message: products.error.message })}
          </div>
        ) : null}
        {products.isSuccess && filtered.length === 0 ? (
          <div className="py-12 text-center text-[12.5px] italic text-muted-foreground">
            {t('noProducts', { searching: q ? 'yes' : 'no' })}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {filtered.map((pr) => {
            const item = toProductItem(pr);
            const onNode = already.has(pr.retailerId);
            const blocked = onNode || !pr.inStock;
            const isPicked = !!picked[pr.retailerId];
            return (
              <button
                key={pr.retailerId}
                type="button"
                disabled={blocked}
                onClick={() => toggle(item)}
                className={cn(
                  'rounded-lg border p-2 text-left transition',
                  isPicked
                    ? 'border-brand bg-brand/10'
                    : 'border-border bg-background hover:bg-muted',
                  blocked ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
                )}
              >
                <Thumb src={pr.image} className="mb-2 aspect-square w-full" />
                <div className="line-clamp-2 text-[12px] font-semibold leading-tight">
                  {pr.name}
                </div>
                <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
                  {formatPrice(pr.currency, pr.priceMinor)}
                </div>
                <div className="mt-1 flex items-center gap-1">
                  {!pr.inStock ? (
                    <span className="font-mono text-[9.5px] text-red-600">{t('outOfStock')}</span>
                  ) : null}
                  {onNode ? (
                    <span className="font-mono text-[9.5px] text-muted-foreground">
                      {t('onNode')}
                    </span>
                  ) : null}
                  {isPicked ? (
                    <span className="font-mono text-[9.5px] text-brand">{t('picked')}</span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <div className="text-[12px] text-muted-foreground">{t('selected', { count })}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border bg-background px-3 py-1.5 text-[12px] hover:bg-muted"
          >
            {tc('cancel')}
          </button>
          <button
            type="button"
            disabled={count === 0}
            onClick={() => {
              onPicked(Object.values(picked));
              onClose();
            }}
            className="rounded-full bg-brand px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('addToNode', { count })}
          </button>
        </div>
      </div>
    </>
  );
}

/** The modal that lists a store's products (Reference's ProductPickerModal). Its body mounts on open, so each open starts clean. */
export function ProductPickerModal(props: {
  open: boolean;
  provider: Provider;
  storeId: string;
  already: Set<string>;
  onClose: () => void;
  onPicked: (items: ProductItem[]) => void;
}) {
  const t = useTranslations(NS);
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      eyebrow={t('pickEyebrow')}
      title={t(`providers.${props.provider}.title`)}
      size="lg"
      closeLabel={t('close')}
    >
      <p className="mb-3 text-[12px] text-muted-foreground">{t('pickerHelp')}</p>
      {props.open ? <PickerBody {...props} /> : null}
    </Modal>
  );
}

function CommerceFormBody({ p, provider }: { p: FormProps; provider: Provider }) {
  const t = useTranslations(NS);
  const th = useTranslations('flb.builder.formsChannels.helpers');
  const unofficial = useUnofficialWhatsapp();
  const [pickerOpen, setPickerOpen] = useState(false);
  const href = PROVIDER_HREF[provider];
  const stores = p.env.ctx.stores[provider];
  const storeId = String(p.data.storeId ?? '');
  const items = readProductItems(p.data.productItems);
  const first = p.env.loading
    ? t('loadingStores')
    : stores.length
      ? t('pickStore')
      : t(`providers.${provider}.noStore`);
  const storeOpts = withSavedOption(
    [
      { v: '', l: first },
      ...stores.map((s) => ({ v: s.id, l: storeLabel(s.name, s.currency, th) })),
    ],
    storeId,
    (id) => t('savedStore', { id: id.slice(0, 8) }),
  );
  return (
    <>
      <Intro
        sub={t.rich('portsHelp', {
          purchased: (c) => <span className="font-mono text-brand">{c}</span>,
          abandoned: (c) => <span className="font-mono text-[#E87A5D]">{c}</span>,
        })}
      >
        {t('intro', { unofficial: unofficial ? 'yes' : 'no' })}
      </Intro>
      <Field
        label={t('store')}
        hint={t.rich(`providers.${provider}.hint`, {
          link: (c) => <ExtLink href={href}>{c}</ExtLink>,
        })}
      >
        <SelectInput value={storeId} onChange={(v) => p.set('storeId', v)} options={storeOpts} />
      </Field>
      <Field label={t('products')} hint={t('productsHint', { max: MAX_PRODUCT_ITEMS })}>
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div
              key={`${it.retailer_id}-${i}`}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5"
            >
              <Thumb src={it.image} className="h-10 w-10 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-semibold">
                  {it.name || it.retailer_id}
                </div>
                <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                  {formatPrice(it.currency, it.price_minor)} · {it.retailer_id}
                </div>
              </div>
              <RemoveButton
                onClick={() =>
                  p.set(
                    'productItems',
                    items.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
          ))}
          {items.length === 0 ? (
            <div className="text-[11.5px] italic text-muted-foreground">{t('noItems')}</div>
          ) : null}
          <button
            type="button"
            disabled={!storeId}
            onClick={() => setPickerOpen(true)}
            className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-brand/50 bg-muted px-3 py-2 text-[12px] font-semibold text-brand hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PlusIcon />
            {items.length === 0 ? t('pickProducts') : t('pickMore')}
          </button>
        </div>
      </Field>
      <Field label={t('header')}>
        <TextInput
          value={p.data.headerText}
          onChange={(v) => p.set('headerText', v)}
          placeholder={t('headerPlaceholder')}
        />
      </Field>
      <Field label={t('body')}>
        <TextArea
          rows={3}
          value={p.data.bodyText}
          onChange={(v) => p.set('bodyText', v)}
          placeholder={t('bodyPlaceholder')}
        />
      </Field>
      <Field label={t('footer')}>
        <TextInput
          value={p.data.footerText}
          onChange={(v) => p.set('footerText', v)}
          placeholder={t('footerPlaceholder')}
        />
      </Field>
      <Field
        label={t('abandonedWait')}
        hint={t.rich('abandonedWaitHint', { b: (c) => <b>{c}</b> })}
      >
        <SelectInput
          value={String(p.data.abandonedWaitMinutes || 5)}
          onChange={(v) => p.set('abandonedWaitMinutes', parseInt(v, 10))}
          options={WAIT_OPTIONS.map((o) => ({ v: o.v, l: t(o.key, { count: o.count }) }))}
        />
      </Field>
      <ProductPickerModal
        open={pickerOpen}
        provider={provider}
        storeId={storeId}
        already={new Set(items.map((it) => it.retailer_id))}
        onClose={() => setPickerOpen(false)}
        onPicked={(picked) => p.set('productItems', mergePicked(items, picked))}
      />
    </>
  );
}

const commerceForm =
  (provider: Provider): FormComponent =>
  (p) => <CommerceFormBody p={p} provider={provider} />;

export const WhatsappShopForm = commerceForm('whatsapp_shop');
export const WoocommerceForm = commerceForm('woocommerce');
export const ShopifyForm = commerceForm('shopify');
