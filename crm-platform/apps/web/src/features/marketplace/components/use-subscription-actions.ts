'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { MarketBillingPeriod, MarketSubscription } from '@crm/contracts';
import { useToast } from '@crm/ui';
import {
  cancelSubscription,
  fetchSubscriptions,
  mktKeys,
  refreshAfterSubscription,
  resumeSubscription,
  subscribeToApp,
  syncSubscription,
} from '../api';
import { mktError } from '../lib/errors';
import { subscribeBody, subscribeNext } from '../lib/pricing';
import { useAsyncAction } from './use-async-action';

export type SubscribeMode = 'pay' | 'trial';

/**
 * Subscribe to a paid app. Paying navigates to the checkout page the answer names (the existing add-on checkout: no payment form is
 * built here); a trial, or access that needed no payment, refreshes the screens so the install flow, with its normal consent step,
 * is what the person sees next. A refused trial or sale re-reads the app, so the page shows what is true now.
 */
export function useSubscribe(app: { slug: string; name: string }) {
  const t = useTranslations('marketplace.subscribe');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const action = useAsyncAction();
  const [mode, setMode] = useState<SubscribeMode | null>(null);
  const [noCheckout, setNoCheckout] = useState(false);
  // Once the answer sent the browser to checkout the buttons stay disabled until the page is left, so a second click cannot start
  // a second navigation. Leaving unmounts this page, and coming back mounts it fresh.
  const [redirecting, setRedirecting] = useState(false);

  const run = async (startTrial: boolean, period: MarketBillingPeriod = 'monthly') => {
    setMode(startTrial ? 'trial' : 'pay');
    setNoCheckout(false);
    const out = await action.run(() => subscribeToApp(app.slug, subscribeBody(startTrial, period)));
    if (!out.ok) {
      const kind = mktError(out.error).kind;
      if (kind === 'trialUnavailable' || kind === 'notForSale')
        refreshAfterSubscription(qc, app.slug);
      return;
    }
    const next = subscribeNext(out.value);
    if (next.kind === 'checkout') {
      setRedirecting(true);
      router.push(next.href);
      return;
    }
    if (next.kind === 'noCheckout') {
      setNoCheckout(true);
      return;
    }
    if (out.value.subscription) syncSubscription(qc, app.slug, out.value.subscription);
    else refreshAfterSubscription(qc, app.slug);
    toast(t(`toast.${next.outcome}`, { name: app.name }));
  };

  return {
    run,
    pending: action.pending || redirecting,
    /** Which of the two buttons was pressed, for its spinner. */
    mode,
    error: action.error,
    /** The answer said "pay" without a usable checkout address. */
    noCheckout,
  };
}

/** Cancel and Resume of one app's subscription: each answers the new subscription, which replaces the cached one. */
export function useSubscriptionChange(app: { slug: string }) {
  const qc = useQueryClient();
  const cancel = useAsyncAction();
  const resume = useAsyncAction();

  const settle = (next: MarketSubscription | null, error: unknown) => {
    if (next) {
      syncSubscription(qc, app.slug, next);
      return;
    }
    // The state moved on under the person (it was cancelled already, or ended): read it again.
    const kind = mktError(error).kind;
    if (kind === 'subscriptionState' || kind === 'subscriptionNotFound')
      refreshAfterSubscription(qc, app.slug);
  };

  const doCancel = async (): Promise<MarketSubscription | null> => {
    const out = await cancel.run(() => cancelSubscription(app.slug));
    const next = out.ok ? out.value.subscription : null;
    settle(next, out.ok ? null : out.error);
    return next;
  };

  const doResume = async (): Promise<MarketSubscription | null> => {
    const out = await resume.run(() => resumeSubscription(app.slug));
    const next = out.ok ? out.value.subscription : null;
    settle(next, out.ok ? null : out.error);
    return next;
  };

  return {
    cancel: {
      run: doCancel,
      pending: cancel.pending,
      error: cancel.error,
      clear: cancel.clearError,
    },
    resume: { run: doResume, pending: resume.pending, error: resume.error },
  };
}

/** The workspace's own subscriptions (paid, trial and comp). Read with `market.apps.read`. */
export function useSubscriptions(enabled = true) {
  return useQuery({
    queryKey: mktKeys.subscriptions,
    queryFn: ({ signal }) => fetchSubscriptions(signal),
    enabled,
  });
}
