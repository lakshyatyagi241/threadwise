'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { Select, cn } from '@crm/ui';
import type { GatewayScope } from '../lib/gateway-scope';

export interface ShopOption {
  id: string;
  name: string;
}

/**
 * Which row of gateways the screen edits: the workspace default (every shop and Sales invoices) or one shop's own override. The
 * shop list is offered when there are two or more shops; with one, its name is shown.
 */
export function GatewayScopePicker({
  kind,
  onKind,
  shops,
  shopId,
  onShop,
}: {
  kind: GatewayScope['kind'];
  onKind: (kind: GatewayScope['kind']) => void;
  shops: readonly ShopOption[];
  shopId: string | undefined;
  onShop: (id: string) => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.gateways.scope');
  const groupId = useId();
  const shop = shops.find((s) => s.id === shopId);
  const storeDisabled = !shopId;

  const option = (value: GatewayScope['kind'], title: string, hint: string, disabled = false) => (
    <label
      key={value}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition',
        kind === value ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        type="radio"
        name={`${groupId}-scope`}
        value={value}
        checked={kind === value}
        disabled={disabled}
        onChange={() => onKind(value)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );

  return (
    <fieldset className="space-y-3" data-testid="gateway-scope">
      <legend className="mb-2 text-sm font-medium">{t('label')}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {option('workspace', t('workspace'), t('workspaceHint'))}
        {option(
          'store',
          t('store'),
          storeDisabled ? t('noShop') : t('storeHint', { shop: shop?.name ?? '' }),
          storeDisabled,
        )}
      </div>
      {kind === 'store' && shopId && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor={`${groupId}-shop`} className="font-medium">
            {t('shop')}
          </label>
          {shops.length >= 2 ? (
            <Select
              id={`${groupId}-shop`}
              value={shopId}
              onChange={(e) => onShop(e.target.value)}
              className="w-auto min-w-48"
            >
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          ) : (
            <span id={`${groupId}-shop`} className="rounded-md bg-muted px-2 py-1">
              {shop?.name ?? shopId}
            </span>
          )}
        </div>
      )}
    </fieldset>
  );
}
