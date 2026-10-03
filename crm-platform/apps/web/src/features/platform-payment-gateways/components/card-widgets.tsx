'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Card } from '@crm/ui';
import { postForm } from '../lib/provider-widgets';

type Params = Record<string, string | number | boolean>;

const BRAINTREE_SCRIPT = 'https://js.braintreegateway.com/web/dropin/1.40.2/js/dropin.min.js';

function addScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('script_blocked'));
    document.head.appendChild(el);
  });
}

/** HyperPay's own payment form: its script finds the `paymentWidgets` form and posts the result to our return URL (WD-PAYGW-023). */
export function HyperpayWidget({ params }: { params: Params }) {
  const t = useTranslations('platform-payment-gateways.checkout');
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    addScript(String(params.scriptUrl)).catch(() => setBlocked(true));
  }, [params.scriptUrl]);
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('cardTitle')}</h1>
      {blocked && <Alert tone="danger">{t('errors.widgetBlocked')}</Alert>}
      <Card className="p-4">
        <form
          action={String(params.returnUrl)}
          className="paymentWidgets"
          data-brands={String(params.brands)}
        />
      </Card>
    </div>
  );
}

interface DropIn {
  requestPaymentMethod: () => Promise<{ nonce: string }>;
  teardown: () => Promise<void>;
}
interface BraintreeGlobal {
  dropin: {
    create: (o: {
      authorization: string;
      container: HTMLElement;
      card: { cardholderName: { required: boolean } };
    }) => Promise<DropIn>;
  };
}

/**
 * Braintree Drop-in (WD-PAYGW-021): the card is tokenised in the browser; only the nonce is posted, to the return URL that
 * carries this order's own token, so a nonce can never be spent on a different order.
 */
export function BraintreeWidget({ params }: { params: Params }) {
  const t = useTranslations('platform-payment-gateways.checkout');
  const box = useRef<HTMLDivElement>(null);
  const instance = useRef<DropIn | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        await addScript(BRAINTREE_SCRIPT);
        const bt = (window as unknown as { braintree?: BraintreeGlobal }).braintree;
        if (!bt || !box.current) throw new Error('braintree_missing');
        const dropin = await bt.dropin.create({
          authorization: String(params.clientToken),
          container: box.current,
          card: { cardholderName: { required: true } },
        });
        if (!live) return void dropin.teardown();
        instance.current = dropin;
        setReady(true);
      } catch {
        if (live) setProblem(true);
      }
    })();
    return () => {
      live = false;
      void instance.current?.teardown();
    };
  }, [params.clientToken]);

  const pay = async () => {
    if (!instance.current) return;
    setBusy(true);
    try {
      const { nonce } = await instance.current.requestPaymentMethod();
      postForm(String(params.returnUrl), { payment_method_nonce: nonce });
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('cardTitle')}</h1>
      {problem && <Alert tone="danger">{t('errors.widgetBlocked')}</Alert>}
      <Card className="space-y-4 p-4">
        <div ref={box} />
        <Button
          type="button"
          className="w-full"
          disabled={!ready || busy}
          onClick={() => void pay()}
        >
          {busy ? t('processing') : t('payNow')}
        </Button>
      </Card>
    </div>
  );
}
