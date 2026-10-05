'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { CreateStoreOrderInvoiceResponse, StoreOrderDetail } from '@crm/contracts';
import { Alert, Button, Field, Input, Select, Spinner, useToast } from '@crm/ui';
import {
  useCreateOrderInvoice,
  useGenerateOrderPaymentLink,
  useSendOrderPaymentLink,
} from '../api/hooks';
import { withShop } from '../lib/format';
import { defaultGateway, isHttpUrl } from '../lib/orders-detail';
import { LinkButton, useErrorLine } from './parts';

/** Copies a value to the clipboard and says so for two seconds; if the browser refuses, the value stays selectable on the page. */
export function CopyButton({ value }: { value: string }) {
  const tc = useTranslations('checkout-orders-merchant-payments.common');
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      setDone(false);
    }
  };
  return (
    <Button variant="secondary" size="sm" onClick={() => void copy()}>
      <span aria-live="polite">{done ? tc('copied') : tc('copy')}</span>
    </Button>
  );
}

/**
 * The two ways to get a payment link to the buyer: paste one you already have (WaDesk "Send payment link via WhatsApp"), or
 * mint a hosted link on the shop's gateway and send it ("Send checkout link"). Both save the link on the order.
 */
export function OrderPaymentActions({
  order,
  shop,
  canManage,
}: {
  order: StoreOrderDetail;
  shop: string | undefined;
  canManage: boolean;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.orderDetail.pay');
  const tForm = useTranslations('checkout-orders-merchant-payments.orderDetail.form');
  const { toast } = useToast();
  const errLine = useErrorLine();
  const send = useSendOrderPaymentLink(order.id);
  const generate = useGenerateOrderPaymentLink(order.id);
  const [url, setUrl] = useState(order.paymentLink ?? '');
  const [gateway, setGateway] = useState(() => defaultGateway(order));
  const [result, setResult] = useState<{ url: string; sent: boolean } | null>(null);
  const urlTrim = url.trim();
  const urlInvalid = urlTrim !== '' && !isHttpUrl(urlTrim);
  // The gateway the buyer will be sent to may have been removed since the page loaded.
  const gatewayValue = order.availableGateways.some((g) => g.slug === gateway)
    ? gateway
    : defaultGateway(order);

  const onSend = () => {
    if (!isHttpUrl(urlTrim)) return;
    send.mutate(
      { paymentLink: urlTrim },
      {
        onSuccess: (res) => (res.sent ? toast(t('sent')) : toast(t('savedNotSent'), 'danger')),
        onError: (e) => toast(errLine(e), 'danger'),
      },
    );
  };
  const onGenerate = () => {
    generate.mutate(gatewayValue ? { gateway: gatewayValue } : {}, {
      onSuccess: (res) => {
        if (res.url) setResult({ url: res.url, sent: res.sent });
        if (res.sent) toast(t('sent'));
        else toast(t('savedNotSent'), 'danger');
      },
      onError: (e) => toast(errLine(e), 'danger'),
    });
  };

  return (
    <section className="space-y-4 rounded-lg border border-border bg-background p-4 sm:p-5">
      <h2 className="text-base font-semibold">{t('title')}</h2>

      {order.paymentLink && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">{t('current')}</div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={order.paymentLink}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="min-w-0 max-w-full break-all text-sm text-primary hover:underline"
            >
              {order.paymentLink}
            </a>
            <CopyButton value={order.paymentLink} />
          </div>
        </div>
      )}

      {canManage && (
        <>
          <div className="space-y-2 border-t border-border pt-4">
            <h3 className="text-sm font-semibold">{t('generateTitle')}</h3>
            {order.availableGateways.length === 0 ? (
              <Alert tone="warning" className="space-y-2">
                <div className="font-medium">{t('noGatewayTitle')}</div>
                <p>{t('noGatewayMessage')}</p>
                <LinkButton variant="secondary" href={withShop('/store/gateways', shop)}>
                  {t('noGatewayAction')}
                </LinkButton>
              </Alert>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">{t('generateHint')}</p>
                <div className="flex flex-wrap items-end gap-2">
                  <Field
                    label={t('gatewayLabel')}
                    htmlFor="order-gateway"
                    className="min-w-44 flex-1"
                  >
                    <Select
                      id="order-gateway"
                      value={gatewayValue}
                      onChange={(e) => setGateway(e.target.value)}
                    >
                      {order.availableGateways.map((g) => (
                        <option key={g.slug} value={g.slug}>
                          {g.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button onClick={onGenerate} disabled={generate.isPending}>
                    {generate.isPending && <Spinner />}
                    {t('generateButton')}
                  </Button>
                </div>
              </>
            )}
            {result && (
              <Alert tone={result.sent ? 'success' : 'warning'} className="space-y-2">
                <div className="font-medium">{t('resultTitle')}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    dir="ltr"
                    className="min-w-0 max-w-full break-all underline"
                  >
                    {result.url}
                  </a>
                  <CopyButton value={result.url} />
                </div>
                <p>{result.sent ? t('resultSent') : t('resultNotSent')}</p>
              </Alert>
            )}
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <h3 className="text-sm font-semibold">{t('sendTitle')}</h3>
            <div className="flex flex-wrap items-end gap-2">
              <Field
                label={t('sendLabel')}
                htmlFor="order-send-link"
                className="min-w-56 flex-1"
                error={urlInvalid ? tForm('invalidLink') : undefined}
              >
                <Input
                  id="order-send-link"
                  type="url"
                  dir="ltr"
                  inputMode="url"
                  maxLength={1024}
                  placeholder="https://rzp.io/..."
                  value={url}
                  invalid={urlInvalid}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              <Button
                variant="secondary"
                onClick={onSend}
                disabled={!isHttpUrl(urlTrim) || send.isPending}
              >
                {send.isPending && <Spinner />}
                {t('sendButton')}
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** Turn the order into a CRM invoice (and its sales order); once it exists the button gives way to links into Sales. */
export function OrderInvoiceCard({
  order,
  canManage,
}: {
  order: StoreOrderDetail;
  canManage: boolean;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.orderDetail.invoice');
  const { toast } = useToast();
  const errLine = useErrorLine();
  const create = useCreateOrderInvoice(order.id);
  const [created, setCreated] = useState<CreateStoreOrderInvoiceResponse | null>(null);
  const invoiceId = created?.invoiceId ?? order.invoiceId;
  const salesOrderId = created?.salesOrderId ?? order.salesOrderId;

  if (!invoiceId && !canManage) return null;

  const onCreate = () =>
    create.mutate(undefined, {
      onSuccess: (res) => {
        setCreated(res);
        toast(
          res.existing
            ? t('existing')
            : res.number
              ? t('created', { number: res.number })
              : t('createdNoNumber'),
        );
      },
      onError: (e) => toast(errLine(e), 'danger'),
    });

  return (
    <section className="space-y-3 rounded-lg border border-border bg-background p-4">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      {invoiceId ? (
        <div className="space-y-3">
          {created?.existing && <p className="text-sm text-muted-foreground">{t('existing')}</p>}
          <div className="flex flex-wrap gap-2">
            <LinkButton variant="secondary" href={`/invoices/${invoiceId}`}>
              {t('viewInvoice')}
            </LinkButton>
            {salesOrderId && (
              <LinkButton variant="secondary" href={`/sales-orders/${salesOrderId}`}>
                {t('viewSalesOrder')}
              </LinkButton>
            )}
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
          <Button onClick={onCreate} disabled={create.isPending}>
            {create.isPending && <Spinner />}
            {create.isPending ? t('creating') : t('create')}
          </Button>
        </>
      )}
    </section>
  );
}
