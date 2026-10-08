'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { StoreGateway, StoreGatewayDriver, StoreGatewayTestResult } from '@crm/contracts';
import { Alert, Button, ConfirmDialog, Spinner, Switch, useToast } from '@crm/ui';
import {
  useRemoveGateway,
  useSetDefaultGateway,
  useTestGateway,
  useToggleGateway,
} from '../api/hooks';
import { canSetDefault, cardState } from '../lib/gateway-scope';
import { ToneBadge, useErrorLine } from './parts';
import { GatewayTestResult } from './gateway-test-result';

const chip = 'rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground';

/**
 * One gateway of the catalogue, with the state saved for the selected scope. Every action works on the row of that scope only
 * (`storefrontId` undefined is the workspace row). Without the manage permission the buttons are not drawn.
 */
export function GatewayCard({
  driver,
  saved,
  storefrontId,
  scopeText,
  canManage,
  onConfigure,
}: {
  driver: StoreGatewayDriver;
  saved: StoreGateway | undefined;
  storefrontId: string | undefined;
  /** The scope in words, for the remove confirmation. */
  scopeText: string;
  canManage: boolean;
  onConfigure: (driver: StoreGatewayDriver) => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.gateways');
  const common = useTranslations('checkout-orders-merchant-payments.common');
  const { toast } = useToast();
  const errorLine = useErrorLine();
  const test = useTestGateway();
  const toggle = useToggleGateway();
  const makeDefault = useSetDefaultGateway();
  const remove = useRemoveGateway();
  const [result, setResult] = useState<StoreGatewayTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const state = cardState(driver, saved);
  const busy = test.isPending || toggle.isPending || makeDefault.isPending || remove.isPending;
  const titleId = `gw-${driver.slug}-title`;

  function runTest() {
    setResult(null);
    setTestError(null);
    test.mutate(
      { slug: driver.slug, storefrontId },
      {
        onSuccess: (r) => setResult(r),
        onError: (e) => setTestError(errorLine(e)),
      },
    );
  }

  function runToggle() {
    if (!saved) return;
    toggle.mutate(
      { slug: driver.slug, storefrontId },
      {
        onSuccess: (row) =>
          toast(
            row.active
              ? t('toast.switchedOn', { name: driver.name })
              : t('toast.switchedOff', { name: driver.name }),
          ),
        onError: (e) => toast(errorLine(e), 'danger'),
      },
    );
  }

  function runDefault() {
    makeDefault.mutate(
      { slug: driver.slug, storefrontId },
      {
        onSuccess: () => toast(t('toast.defaultSet', { name: driver.name })),
        // A 422 here means the gateway is switched off or a required field is empty: the errors copy says that.
        onError: (e) => toast(errorLine(e), 'danger'),
      },
    );
  }

  function runRemove() {
    remove.mutate(
      { slug: driver.slug, storefrontId },
      {
        onSuccess: () => {
          setConfirmRemove(false);
          setResult(null);
          toast(t('toast.removed', { name: driver.name }));
        },
        onError: (e) => {
          setConfirmRemove(false);
          toast(errorLine(e), 'danger');
        },
      },
    );
  }

  return (
    <li
      aria-labelledby={titleId}
      data-testid={`gateway-${driver.slug}`}
      data-state={state}
      className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titleId} className="truncate text-sm font-semibold">
            {driver.name}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{driver.description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {driver.available ? (
            <ToneBadge tone="success">{t('card.available')}</ToneBadge>
          ) : (
            <ToneBadge tone="neutral">{t('card.unavailable')}</ToneBadge>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {driver.supportsPaymentLinks && <ToneBadge tone="info">{t('card.paymentLinks')}</ToneBadge>}
        {driver.regions.map((r) => (
          <span key={`r-${r}`} className={chip}>
            {r}
          </span>
        ))}
        {driver.currencies.map((c) => (
          <span key={`c-${c}`} className={chip}>
            {c}
          </span>
        ))}
      </div>

      {!driver.available && (
        <p className="text-xs text-muted-foreground">{t('card.unavailableNote')}</p>
      )}

      {saved && (
        <div
          className="space-y-2 rounded-md bg-muted/50 p-2.5"
          data-testid={`gateway-${driver.slug}-saved`}
        >
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {state === 'active' && <ToneBadge tone="success">{t('card.active')}</ToneBadge>}
            {state === 'off' && <ToneBadge tone="neutral">{t('card.off')}</ToneBadge>}
            {state === 'incomplete' && <ToneBadge tone="warning">{t('card.incomplete')}</ToneBadge>}
            {saved.isDefault && <ToneBadge tone="info">{t('card.default')}</ToneBadge>}
            <span className="text-muted-foreground">
              {saved.mode === 'live' ? t('mode.live') : t('mode.test')}
            </span>
          </div>
          {saved.migratedFromStorefront && (
            <p className="text-xs text-muted-foreground">{t('card.migrated')}</p>
          )}
          {saved.webhookSecretMissing && (
            <Alert tone="warning" className="py-1.5 text-xs">
              {t('card.webhookMissing')}
            </Alert>
          )}
        </div>
      )}
      {!saved && driver.available && (
        <p className="text-xs text-muted-foreground">{t('card.notSetUp')}</p>
      )}

      {canManage && (saved || driver.available) && (
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {driver.available && (
            <Button
              size="sm"
              variant={saved ? 'secondary' : 'primary'}
              onClick={() => onConfigure(driver)}
              disabled={busy}
            >
              {saved ? t('card.edit') : t('card.configure')}
            </Button>
          )}
          {saved && driver.available && (
            <>
              <Button size="sm" variant="secondary" onClick={runTest} disabled={busy}>
                {test.isPending && <Spinner />}
                {test.isPending ? t('card.testing') : t('card.test')}
              </Button>
              {canSetDefault(saved) && (
                <Button size="sm" variant="secondary" onClick={runDefault} disabled={busy}>
                  {makeDefault.isPending && <Spinner />}
                  {t('card.setDefault')}
                </Button>
              )}
              <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={saved.active}
                  onCheckedChange={runToggle}
                  disabled={busy}
                  label={t('card.activeSwitch', { name: driver.name })}
                />
                {saved.active ? t('card.active') : t('card.off')}
              </span>
            </>
          )}
          {saved && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              onClick={() => setConfirmRemove(true)}
              disabled={busy}
            >
              {t('card.remove')}
            </Button>
          )}
        </div>
      )}

      {testError && (
        <Alert tone="danger" className="text-xs">
          {testError}
        </Alert>
      )}
      {result && (
        <GatewayTestResult result={result} driver={driver} onDismiss={() => setResult(null)} />
      )}

      {canManage && confirmRemove && (
        <ConfirmDialog
          open
          tone="danger"
          title={t('card.removeTitle', { name: driver.name })}
          message={t('card.removeMessage', { scope: scopeText })}
          confirmLabel={t('card.removeConfirm')}
          cancelLabel={common('cancel')}
          busy={remove.isPending}
          onConfirm={runRemove}
          onClose={() => setConfirmRemove(false)}
        />
      )}
    </li>
  );
}
