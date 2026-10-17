'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MarketOperatorSubscription } from '@crm/contracts';
import { Button, Field, Input, Modal, Select, Spinner } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { fetchWorkspacePlans } from '@/features/plans-subscriptions-trials/api';
import {
  cancelSubscription,
  compSubscription,
  fetchSubscriptionSummary,
  marketKeys,
  unlockSubscriptionPrice,
} from '../api';
import { marketError } from '../lib/errors';
import {
  cancelCheck,
  cancelChoices,
  cancelPayload,
  compCheck,
  compPayload,
  initialCancelDraft,
  initialCompDraft,
  paidApps,
  parseMonths,
  unlockCheck,
  unlockPayload,
  type CancelChoice,
  type CancelDraft,
  type CompDraft,
} from '../lib/subscriptions';
import { DurationField, NoteField } from './comp-fields';
import { ErrorLine, Failure } from './ui';
import { useDebounced } from './use-docs-check';

/** What a change to a subscription makes stale: the list, the per-app counts and revenue, and the listing's own count. */
function useRefreshSubscriptions() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: marketKeys.subscriptionsAll });
    void qc.invalidateQueries({ queryKey: marketKeys.subscriptionSummary });
    void qc.invalidateQueries({ queryKey: marketKeys.appsAll });
    void qc.invalidateQueries({ queryKey: marketKeys.appDetailsAll });
  };
}

// --- cancel -----------------------------------------------------------------------------------------------------------------------------

/**
 * Cancels one workspace's subscription: at the end of the period it has paid for (renewal stops, access runs to the date) or right now
 * (the installation is paused, its data kept). The options offered are the ones the API accepts for this subscription; a reason is required.
 */
export function CancelSubscriptionDialog({
  subscription,
  onClose,
}: {
  subscription: MarketOperatorSubscription;
  onClose: () => void;
}) {
  const t = useTranslations('marketplace.operator.cancelDialog');
  const format = useFormatter();
  const toast = useToast();
  const refresh = useRefreshSubscriptions();
  const [draft, setDraft] = useState<CancelDraft>(() => initialCancelDraft(subscription));
  const choices = cancelChoices(subscription);
  const check = cancelCheck(subscription, draft);
  const formId = 'cancel-subscription-form';
  const end = subscription.currentPeriodEnd
    ? format.dateTime(new Date(subscription.currentPeriodEnd), { dateStyle: 'medium' })
    : '';
  const names = { workspace: subscription.workspace.name, app: subscription.app.name };

  const cancel = useMutation({
    mutationFn: () => cancelSubscription(subscription.id, cancelPayload(draft)),
    onSuccess: () => {
      toast.success(t(draft.when === 'now' ? 'done.now' : 'done.periodEnd', names));
      refresh();
      onClose();
    },
    onError: (e) => {
      // The row moved under us (it ended, or was cancelled by someone else): show what it is now.
      if (marketError(e).kind === 'general') refresh();
    },
  });

  return (
    <Modal
      open
      size="md"
      eyebrow={t('eyebrow')}
      title={t('title', { workspace: subscription.workspace.name })}
      closeLabel={t('close')}
      onClose={() => {
        if (!cancel.isPending) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={cancel.isPending}>
            {t('back')}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={draft.when === 'now' ? 'danger' : 'primary'}
            disabled={!check.canSubmit || cancel.isPending}
          >
            {cancel.isPending && <Spinner />}
            {draft.when === 'now' ? t('confirmNow') : t('confirmPeriod')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (check.canSubmit) cancel.mutate();
        }}
      >
        <p className="text-muted-foreground" dir="auto">
          {t('summary', names)}
        </p>

        <fieldset className="min-w-0 space-y-2" disabled={cancel.isPending}>
          <legend className="mb-1 font-medium">{t('when')}</legend>
          {choices.map((c: CancelChoice) => (
            <label key={c} className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="cancel-when"
                value={c}
                className="mt-0.5 size-4 accent-[var(--primary)]"
                checked={draft.when === c}
                onChange={() => setDraft({ ...draft, when: c })}
              />
              <span>
                <span className="block font-medium">
                  {c === 'periodEnd' ? t('periodEnd.label') : t('now.label')}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {c === 'periodEnd'
                    ? t('periodEnd.detail', { ...names, date: end })
                    : t('now.detail')}
                </span>
              </span>
            </label>
          ))}
          {subscription.currentPeriodEnd === null && (
            <p className="text-xs text-muted-foreground">{t('noEnd')}</p>
          )}
          {subscription.status === 'canceling' && subscription.currentPeriodEnd !== null && (
            <p className="text-xs text-muted-foreground">{t('ending', { date: end })}</p>
          )}
        </fieldset>

        <NoteField
          id="cancel-reason"
          label={t('reason')}
          value={draft.reason}
          rule={check.reason}
          disabled={cancel.isPending}
          onChange={(reason) => setDraft({ ...draft, reason })}
        />

        <ErrorLine error={cancel.error} />
      </form>
    </Modal>
  );
}

// --- unlock the price -------------------------------------------------------------------------------------------------------------------

/**
 * Releases one subscriber from their locked price: their next payment is the listing's price. When the card renews the app the old price
 * lives at the payment provider, so that card renewal is ended at the end of the period they paid for and they subscribe again at the new
 * price; the dialog says which of the two applies.
 */
export function UnlockPriceDialog({
  subscription,
  onClose,
}: {
  subscription: MarketOperatorSubscription;
  onClose: () => void;
}) {
  const t = useTranslations('marketplace.operator.unlockDialog');
  const format = useFormatter();
  const toast = useToast();
  const refresh = useRefreshSubscriptions();
  const [reason, setReason] = useState('');
  const check = unlockCheck(reason);
  const formId = 'unlock-price-form';
  const end = subscription.currentPeriodEnd
    ? format.dateTime(new Date(subscription.currentPeriodEnd), { dateStyle: 'medium' })
    : '';
  const names = { workspace: subscription.workspace.name, app: subscription.app.name, date: end };

  const unlock = useMutation({
    mutationFn: () => unlockSubscriptionPrice(subscription.id, unlockPayload(reason)),
    onSuccess: () => {
      toast.success(t('done', names));
      refresh();
      onClose();
    },
    onError: (e) => {
      if (marketError(e).kind === 'general') refresh();
    },
  });

  return (
    <Modal
      open
      size="md"
      eyebrow={t('eyebrow')}
      title={t('title', { workspace: subscription.workspace.name })}
      closeLabel={t('close')}
      onClose={() => {
        if (!unlock.isPending) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={unlock.isPending}>
            {t('back')}
          </Button>
          <Button type="submit" form={formId} disabled={!check.canSubmit || unlock.isPending}>
            {unlock.isPending && <Spinner />}
            {t('confirm')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (check.canSubmit) unlock.mutate();
        }}
      >
        <p className="text-muted-foreground" dir="auto">
          {t('summary', names)}
        </p>
        <p dir="auto" data-testid="unlock-effect">
          {subscription.autoRenew ? t('effectCard', names) : t('effectPrepaid', names)}
        </p>
        <NoteField
          id="unlock-reason"
          label={t('reason')}
          value={reason}
          rule={check.reason}
          disabled={unlock.isPending}
          onChange={setReason}
        />
        <ErrorLine error={unlock.error} />
      </form>
    </Modal>
  );
}

// --- comp -------------------------------------------------------------------------------------------------------------------------------

const PICKER_LIMIT = 8;

/**
 * Gives one workspace a paid app free. The app is one of the paid ones (taken from the subscriptions summary, which needs no catalogue
 * key), the workspace is found by name in the operator's workspace list, and the comp runs for a number of months or until the operator
 * ends it. A workspace that already pays is refused by the API: cancel its subscription first.
 */
export function CompDialog({
  initialApp,
  onClose,
}: {
  /** The app the page was filtered to, preselected when it is a paid one. */
  initialApp?: string;
  onClose: () => void;
}) {
  const t = useTranslations('marketplace.operator.compDialog');
  const toast = useToast();
  const refresh = useRefreshSubscriptions();
  const summary = useQuery({
    queryKey: marketKeys.subscriptionSummary,
    queryFn: ({ signal }) => fetchSubscriptionSummary(signal),
    refetchOnWindowFocus: false,
  });
  const apps = paidApps(summary.data?.data ?? []);
  const [draft, setDraft] = useState<CompDraft>(() => initialCompDraft(initialApp ?? ''));
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim(), 300);
  const workspaces = useQuery({
    queryKey: marketKeys.workspaces(debounced),
    queryFn: ({ signal }) =>
      fetchWorkspacePlans({ search: debounced || undefined, limit: PICKER_LIMIT }, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const check = compCheck(draft);
  const formId = 'comp-form';
  const app = apps.find((a) => a.slug === draft.app);
  const months = parseMonths(draft.months) ?? 0;

  const comp = useMutation({
    mutationFn: () => compSubscription(draft.app, compPayload(draft)),
    onSuccess: () => {
      toast.success(t('done', { workspace: picked?.name ?? '', app: app?.name ?? draft.app }));
      refresh();
      onClose();
    },
  });

  return (
    <Modal
      open
      size="md"
      eyebrow={t('eyebrow')}
      title={t('title')}
      closeLabel={t('close')}
      onClose={() => {
        if (!comp.isPending) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={comp.isPending}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={!check.canSubmit || comp.isPending}>
            {comp.isPending && <Spinner />}
            {t('submit')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (check.canSubmit) comp.mutate();
        }}
      >
        <p className="text-muted-foreground">{t('intro')}</p>

        <Field label={t('app')} htmlFor="comp-app">
          {summary.isError && !summary.data ? (
            <Failure error={summary.error} onRetry={() => void summary.refetch()} />
          ) : (
            <Select
              id="comp-app"
              value={draft.app}
              disabled={comp.isPending || apps.length === 0}
              onChange={(e) => setDraft({ ...draft, app: e.target.value })}
            >
              <option value="">{t('appPlaceholder')}</option>
              {apps.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {summary.data && apps.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('noPaidApps')}</p>
        )}

        <div className="space-y-2">
          <Field
            label={t('workspaceSearch')}
            htmlFor="comp-workspace-search"
            hint={t('workspaceHint', { count: PICKER_LIMIT })}
          >
            <Input
              id="comp-workspace-search"
              type="search"
              autoComplete="off"
              placeholder={t('workspaceSearchPlaceholder')}
              value={search}
              disabled={comp.isPending}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          {picked && (
            <p className="text-xs font-medium" data-testid="comp-picked" dir="auto">
              {t('workspaceChosen', { name: picked.name })}
            </p>
          )}
          {workspaces.isError && !workspaces.data ? (
            <Failure error={workspaces.error} onRetry={() => void workspaces.refetch()} />
          ) : workspaces.data ? (
            workspaces.data.data.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('workspaceNone')}</p>
            ) : (
              <fieldset className="min-w-0" disabled={comp.isPending}>
                <legend className="sr-only">{t('workspaceResults')}</legend>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {workspaces.data.data.map((w) => (
                    <li key={w.workspaceId}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary">
                        <input
                          type="radio"
                          name="comp-workspace"
                          value={w.workspaceId}
                          className="size-4 accent-[var(--primary)]"
                          checked={draft.workspaceId === w.workspaceId}
                          onChange={() => {
                            setDraft({ ...draft, workspaceId: w.workspaceId });
                            setPicked({ id: w.workspaceId, name: w.name });
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium" dir="auto">
                            {w.name}
                          </span>
                          <span
                            className="block truncate font-mono text-xs text-muted-foreground"
                            dir="ltr"
                          >
                            {w.slug}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground" dir="auto">
                          {t('workspacePlan', { plan: w.planName ?? w.planSlug })}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )
          ) : (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {t('workspaceLoading')}
            </p>
          )}
        </div>

        <DurationField
          id="comp"
          duration={draft.duration}
          months={draft.months}
          disabled={comp.isPending}
          onChange={(next) => setDraft({ ...draft, ...next })}
        />
        <NoteField
          id="comp-note"
          label={t('note')}
          value={draft.note}
          rule={check.note}
          disabled={comp.isPending}
          onChange={(note) => setDraft({ ...draft, note })}
        />

        {(draft.duration === 'open' || months > 0) && (
          <p className="text-xs text-muted-foreground">
            {draft.duration === 'open' ? t('effectOpen') : t('effectMonths', { count: months })}
          </p>
        )}

        <ErrorLine error={comp.error} />
      </form>
    </Modal>
  );
}
