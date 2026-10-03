'use client';

import { useState } from 'react';
import { Modal, cn } from '@crm/ui';
import { useCommerceProducts } from '../../../api/hooks';
import { Field, SelectInput, TextArea, TextInput, controlClass } from '../kit';
import type { FormComponent, FormProps } from '../types';
import {
  MAX_PRODUCT_ITEMS,
  formatPrice,
  mergePicked,
  readProductItems,
  toProductItem,
  withSavedOption,
  type ProductItem,
} from './helpers';
import { Intro, RemoveButton } from './shared';

type Provider = 'whatsapp_shop' | 'woocommerce' | 'shopify';

const PROVIDER_COPY: Record<Provider, { title: string; storeHint: string; noStore: string }> = {
  whatsapp_shop: {
    title: 'WhatsApp catalog products',
    storeHint: 'WhatsApp catalog connected in Catalog.',
    noStore: 'No catalog linked — connect one in Catalog',
  },
  woocommerce: {
    title: 'WooCommerce products',
    storeHint: 'WooCommerce stores connected in Integrations.',
    noStore: 'No store connected — connect one in Integrations',
  },
  shopify: {
    title: 'Shopify products',
    storeHint: 'Shopify stores connected in Shopify.',
    noStore: 'No store connected — connect one in Shopify',
  },
};

const WAIT_OPTIONS = [
  { v: '5', l: '5 minutes' },
  { v: '15', l: '15 minutes' },
  { v: '60', l: '1 hour' },
  { v: '240', l: '4 hours' },
  { v: '1440', l: '1 day' },
];

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
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Record<string, ProductItem>>({});
  const products = useCommerceProducts({ provider, storeId, limit: 100 });
  const list = products.data?.data ?? [];
  const query = q.trim().toLowerCase();
  const filtered = query
    ? list.filter((pr) => pr.name.toLowerCase().includes(query) || pr.retailerId.toLowerCase().includes(query))
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
        placeholder="Search by name or SKU…"
        className={cn(controlClass, 'mb-3')}
      />
      <div className="max-h-[50vh] overflow-y-auto">
        {products.isPending ? (
          <div className="py-12 text-center text-[12.5px] italic text-muted-foreground">Loading products…</div>
        ) : null}
        {products.isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            Couldn&apos;t load products: {products.error.message}
          </div>
        ) : null}
        {products.isSuccess && filtered.length === 0 ? (
          <div className="py-12 text-center text-[12.5px] italic text-muted-foreground">
            No products found. {q ? 'Try a different search.' : 'Connect or sync the store first.'}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {filtered.map((pr) => {
            const item = toProductItem(pr);
            const onNode = already.has(pr.retailerId);
            const isPicked = !!picked[pr.retailerId];
            return (
              <button
                key={pr.retailerId}
                type="button"
                disabled={onNode}
                onClick={() => toggle(item)}
                className={cn(
                  'rounded-lg border p-2 text-left transition',
                  isPicked ? 'border-brand bg-brand/10' : 'border-border bg-background hover:bg-muted',
                  onNode ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
                )}
              >
                <Thumb src={pr.image} className="mb-2 aspect-square w-full" />
                <div className="line-clamp-2 text-[12px] font-semibold leading-tight">{pr.name}</div>
                <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
                  {formatPrice(pr.currency, pr.priceMinor)}
                </div>
                <div className="mt-1 flex items-center gap-1">
                  {onNode ? <span className="font-mono text-[9.5px] text-muted-foreground">on node</span> : null}
                  {isPicked ? <span className="font-mono text-[9.5px] text-brand">✓ picked</span> : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <div className="text-[12px] text-muted-foreground">{count} selected</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border bg-background px-3 py-1.5 text-[12px] hover:bg-muted"
          >
            Cancel
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
            Add {count} to node
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
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      eyebrow="Pick products"
      title={PROVIDER_COPY[props.provider].title}
      size="lg"
      closeLabel="Close"
    >
      <p className="mb-3 text-[12px] text-muted-foreground">
        Tap products to add. Tap again to remove. Already-on-node items are skipped.
      </p>
      {props.open ? <PickerBody {...props} /> : null}
    </Modal>
  );
}

function CommerceFormBody({ p, provider }: { p: FormProps; provider: Provider }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const copy = PROVIDER_COPY[provider];
  const stores = p.env.ctx.stores[provider];
  const storeId = String(p.data.storeId ?? '');
  const items = readProductItems(p.data.productItems);
  const first = p.env.loading ? 'Loading stores…' : stores.length ? '— pick store —' : copy.noStore;
  const storeOpts = withSavedOption(
    [{ v: '', l: first }, ...stores.map((s) => ({ v: s.id, l: s.name }))],
    storeId,
    (id) => `Store ${id.slice(0, 8)} (not in workspace)`,
  );
  return (
    <>
      <Intro
        sub={
          <>
            Ports: <span className="font-mono text-brand">purchased</span> fires when the order webhook lands;{' '}
            <span className="font-mono text-[#E87A5D]">abandoned</span> fires after the wait window with no purchase.
          </>
        }
      >
        Pick a store, then pick the products this node will send. On a WABA conversation we send a native catalog message;
        on Baileys we send each product as a card + a checkout link.
      </Intro>
      <Field label="Store" hint={copy.storeHint}>
        <SelectInput value={storeId} onChange={(v) => p.set('storeId', v)} options={storeOpts} />
      </Field>
      <Field label="Products" hint={`Max ${MAX_PRODUCT_ITEMS} products per node. Tap × to remove.`}>
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div
              key={`${it.retailer_id}-${i}`}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5"
            >
              <Thumb src={it.image} className="h-10 w-10 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-semibold">{it.name || it.retailer_id}</div>
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
            <div className="text-[11.5px] italic text-muted-foreground">No products yet. Click below to add some.</div>
          ) : null}
          <button
            type="button"
            disabled={!storeId}
            onClick={() => setPickerOpen(true)}
            className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-brand/50 bg-muted px-3 py-2 text-[12px] font-semibold text-brand hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {items.length === 0 ? 'Pick products' : 'Pick more products'}
          </button>
        </div>
      </Field>
      <Field label="Header (optional)">
        <TextInput value={p.data.headerText} onChange={(v) => p.set('headerText', v)} placeholder="Our spring picks" />
      </Field>
      <Field label="Body">
        <TextArea
          rows={3}
          value={p.data.bodyText}
          onChange={(v) => p.set('bodyText', v)}
          placeholder="Tap a product to see details"
        />
      </Field>
      <Field label="Footer (optional)">
        <TextInput value={p.data.footerText} onChange={(v) => p.set('footerText', v)} placeholder="Free shipping over $50" />
      </Field>
      <Field
        label="Abandoned-cart wait"
        hint={
          <>
            If no purchase within this window, the <b>abandoned</b> port fires so you can route to a drip / follow-up.
          </>
        }
      >
        <SelectInput
          value={String(p.data.abandonedWaitMinutes || 5)}
          onChange={(v) => p.set('abandonedWaitMinutes', parseInt(v, 10))}
          options={WAIT_OPTIONS}
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
