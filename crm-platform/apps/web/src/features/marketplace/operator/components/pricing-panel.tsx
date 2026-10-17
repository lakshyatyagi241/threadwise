'use client';

import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MARKET_TRIAL_DAYS_MAX,
  type MarketOperatorAppDetail,
  type SetMarketPricingRequest,
} from '@crm/contracts';
import { Alert, Button, ConfirmDialog, Spinner } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { useUnsavedGuard } from '@/features/auth-registration-security/platform/ui/use-unsaved-guard';
import {
  PLANS_QUERY_KEY,
  fetchPlans,
} from '@/features/auth-registration-security/platform/plans/plans-query';
import { marketKeys, setPricing } from '../api';
import { isConflict, marketError } from '../lib/errors';
import { subscriptionsHref } from '../lib/paths';
import { MARKET_PERMISSIONS, type MarketAccess } from '../lib/permissions';
import {
  PRICING_FIELDS,
  draftFromPricing,
  formatMoney,
  hasPricingProblems,
  isPricingDirty,
  isolateLtr,
  pricingConfirmation,
  pricingPayload,
  pricingProblems,
  pricingServerFields,
  type PricingConfirmation,
  type PricingDraft,
  type PricingField,
} from '../lib/pricing';
import { GrandfatherDialog } from './grandfather-dialog';
import { WithdrawnRefundDialog } from './refund-dialogs';
import { PricingFields } from './pricing-fields';
import { AppStatusBadge, ErrorLine, Section, textLink } from './ui';

const NS = 'marketplace.operator.pricing';

/**
 * The pricing of one listing, on its detail page: free or paid per month, the price, currency, trial, the optional yearly price, whether
 * it is on sale, who gets it free through their plan, which plan features a subscription grants, and (when the saved pricing allows it) the
 * "Comp existing users" action. The operator's pricing is the authority; the manifest's `pricing` is shown read-only as the developer's
 * proposal. Changing it needs `platform.market.pricing`; without it the panel is read-only and names the key.
 */
export function PricingPanel({
  app,
  access,
}: {
  app: MarketOperatorAppDetail;
  access: MarketAccess;
}) {
  // A saved or reloaded pricing starts the form over from it. The rowVersion is read at the moment of saving, so a change to the
  // listing's text (which also moves it) does not throw away what the operator typed here.
  return (
    <PricingSection key={`${app.id}:${JSON.stringify(app.pricing)}`} app={app} access={access} />
  );
}

type Confirming = { confirmation: NonNullable<PricingConfirmation>; body: SetMarketPricingRequest };

function PricingSection({ app, access }: { app: MarketOperatorAppDetail; access: MarketAccess }) {
  const t = useTranslations(NS);
  const tp = useTranslations(`${NS}.problems`);
  const tc = useTranslations(`${NS}.confirm`);
  const locale = useLocale();
  const format = useFormatter();
  const toast = useToast();
  const qc = useQueryClient();
  const uid = useId();

  const initial = useMemo(() => draftFromPricing(app.pricing), [app.pricing]);
  const [draft, setDraft] = useState<PricingDraft>(initial);
  const [attempted, setAttempted] = useState(false);
  const [serverFields, setServerFields] = useState<Partial<Record<PricingField, string>>>({});
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [comping, setComping] = useState(false);
  const [refundingAll, setRefundingAll] = useState(false);
  const problems = useMemo(() => pricingProblems(draft), [draft]);
  const dirty = isPricingDirty(initial, draft);
  useUnsavedGuard(dirty);

  const canEdit = access.pricing;

  // The plan list is the operator's own (any operator role reads it). If it cannot be loaded the plan field is typed instead.
  const plans = useQuery({
    queryKey: PLANS_QUERY_KEY,
    queryFn: ({ signal }) => fetchPlans(signal),
    enabled: canEdit,
    refetchOnWindowFocus: false,
  });
  const planList = plans.data?.data ?? null;

  const edit = (patch: Partial<PricingDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    // A refusal belongs to what was sent; once the operator changes anything it no longer describes the form.
    setServerFields((s) => (Object.keys(s).length > 0 ? {} : s));
  };

  const errors = useMemo(() => {
    const out: Partial<Record<PricingField, string>> = {};
    for (const field of PRICING_FIELDS) {
      const code = attempted ? problems[field] : undefined;
      const text =
        serverFields[field] ?? (code ? tp(code, { max: MARKET_TRIAL_DAYS_MAX }) : undefined);
      if (text) out[field] = text;
    }
    return out;
  }, [attempted, problems, serverFields, tp]);

  const reload = () => {
    void qc.invalidateQueries({ queryKey: marketKeys.appDetailsAll });
    void qc.invalidateQueries({ queryKey: marketKeys.appsAll });
  };

  const save = useMutation({
    mutationFn: (body: SetMarketPricingRequest) => setPricing(app.slug, body),
    onSuccess: () => {
      toast.success(t('saved', { name: app.name }));
      setConfirming(null);
      reload();
      void qc.invalidateQueries({ queryKey: marketKeys.subscriptionSummary });
    },
    onError: (e) => {
      setConfirming(null);
      setServerFields(pricingServerFields(marketError(e).problems).fields);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    setServerFields({});
    save.reset();
    if (hasPricingProblems(problems) || !dirty) return;
    const body = pricingPayload(draft, app.rowVersion);
    const confirmation = pricingConfirmation(app.pricing, body, app.activeSubscriptions);
    if (confirmation) setConfirming({ confirmation, body });
    else save.mutate(body);
  };

  const version = app.versions.find((v) => v.id === app.versionId)?.version ?? '-';
  const money = (amount: string | null, currency: string | null) =>
    isolateLtr(formatMoney(amount, currency, locale));
  const proposal = app.manifest.pricing;

  return (
    <Section id="pricing" title={t('title')} description={t('description')}>
      {!canEdit && (
        <Alert data-testid="pricing-read-only">
          {t('readOnly', { permission: MARKET_PERMISSIONS.pricing })}
        </Alert>
      )}
      <p className="max-w-3xl text-xs text-muted-foreground">{t('billing')}</p>

      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <Fact label={t('visibility.label')}>
          <AppStatusBadge status={app.status} />
          <p className="mt-1 text-xs text-muted-foreground">{t('visibility.note')}</p>
        </Fact>
        <Fact label={t('subscribers.label')} testId="pricing-subscribers">
          <span className="font-medium tabular-nums">
            {t('subscribers.count', { count: app.activeSubscriptions })}
          </span>{' '}
          <Link href={subscriptionsHref(app.slug)} className={textLink}>
            {t('subscribers.view')}
          </Link>
          <p className="mt-1 text-xs text-muted-foreground">{t('subscribers.hint')}</p>
        </Fact>
        {app.pricing.priceChangedAt && (
          <Fact label={t('changed')}>
            <time dateTime={app.pricing.priceChangedAt}>
              {format.dateTime(new Date(app.pricing.priceChangedAt), { dateStyle: 'medium' })}
            </time>
          </Fact>
        )}
      </dl>

      <form onSubmit={submit} noValidate className="space-y-5" aria-busy={save.isPending}>
        {isConflict(save.error) && (
          <Alert tone="warning" className="space-y-2">
            <p>{t('conflict')}</p>
            <Button variant="secondary" size="sm" onClick={reload}>
              {t('reload')}
            </Button>
          </Alert>
        )}
        {save.error && !isConflict(save.error) && (
          <ErrorLine error={save.error} shownAtFields={PRICING_FIELDS} />
        )}

        <PricingFields
          idBase={uid}
          draft={draft}
          errors={errors}
          disabled={!canEdit || save.isPending}
          canGrant={app.firstParty}
          planList={planList}
          onChange={edit}
        />

        <div
          className="space-y-1 rounded-md border border-dashed border-border p-3 text-sm"
          data-testid="pricing-proposal"
        >
          <p className="font-medium">{t('proposal.title')}</p>
          <p className="text-xs text-muted-foreground">{t('proposal.intro', { version })}</p>
          <p>
            {t(`proposal.models.${proposal.model}`)}
            {proposal.note && (
              <span className="text-muted-foreground" dir="auto">
                {' '}
                {t('proposal.note', { note: proposal.note })}
              </span>
            )}
          </p>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={save.isPending || !dirty}>
              {save.isPending && <Spinner />}
              {save.isPending ? t('saving') : t('save')}
            </Button>
            <Button
              variant="secondary"
              disabled={save.isPending || !dirty}
              onClick={() => {
                setDraft(initial);
                setAttempted(false);
                setServerFields({});
                save.reset();
              }}
            >
              {t('discard')}
            </Button>
            {!dirty && <p className="text-xs text-muted-foreground">{t('nothingToSave')}</p>}
          </div>
        )}
      </form>

      {canEdit && app.pricing.model === 'paid_monthly' && app.pricing.grandfatherExisting && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
          data-testid="pricing-grandfather"
        >
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium">{t('grants.compExisting')}</p>
            <p className="text-xs text-muted-foreground">{t('grants.compExistingHint')}</p>
          </div>
          <Button variant="secondary" onClick={() => setComping(true)}>
            {t('grants.compExistingAction')}
          </Button>
        </div>
      )}

      {canEdit && app.status === 'killed' && app.pricing.model === 'paid_monthly' && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
          data-testid="pricing-withdrawn-refund"
        >
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium">{t('withdrawn.title')}</p>
            <p className="text-xs text-muted-foreground">{t('withdrawn.hint')}</p>
          </div>
          <Button variant="secondary" onClick={() => setRefundingAll(true)}>
            {t('withdrawn.action')}
          </Button>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          open
          title={
            confirming.confirmation.kind === 'priceChange'
              ? tc('priceChange.title', { name: app.name })
              : tc('toFree.title', { name: app.name })
          }
          message={
            confirming.confirmation.kind === 'priceChange' ? (
              <div className="space-y-2">
                <p>
                  {tc('priceChange.body', {
                    count: confirming.confirmation.subscribers,
                    from: money(
                      confirming.confirmation.from.amount,
                      confirming.confirmation.from.currency,
                    ),
                    to: money(
                      confirming.confirmation.to.amount,
                      confirming.confirmation.to.currency,
                    ),
                  })}
                </p>
                <p>{tc('priceChange.next')}</p>
                <p>{tc('priceChange.paid')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p>{tc('toFree.body', { count: confirming.confirmation.subscribers })}</p>
                <p>{tc('toFree.free')}</p>
                <p>{tc('toFree.paid')}</p>
              </div>
            )
          }
          confirmLabel={
            confirming.confirmation.kind === 'priceChange'
              ? tc('priceChange.action')
              : tc('toFree.action')
          }
          cancelLabel={tc('cancel')}
          busy={save.isPending}
          onConfirm={() => save.mutate(confirming.body)}
          onClose={() => setConfirming(null)}
        />
      )}
      {comping && <GrandfatherDialog app={app} onClose={() => setComping(false)} />}
      {refundingAll && <WithdrawnRefundDialog app={app} onClose={() => setRefundingAll(false)} />}
    </Section>
  );
}

function Fact({
  label,
  children,
  testId,
}: {
  label: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="contents" data-testid={testId}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
