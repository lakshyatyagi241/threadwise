'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import {
  PLAN_FEATURE_KEYS,
  type PlanAdminItem,
  type PlanOverrides,
  type WorkspacePlan,
} from '@crm/contracts';
import { Alert, Badge, Button, Input, Modal, Select } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { attachWorkspacePlan } from '../api';
import {
  addonLists,
  limitGroups,
  limitRowState,
  planValueView,
  unlimitedToggle,
} from './override-rows';

const NS = 'plans-subscriptions-trials';
/** Group names, per-limit labels and hints are the plan editor's (written once, en and ar). */
const EDITOR = 'auth-registration-security.platform.plans.editor';
type FlagChoice = 'default' | 'on' | 'off';

/** "2026-10-02T12:00:00.000Z" -> the value a datetime-local input takes. */
const toInput = (iso: string | null) => (iso ? iso.slice(0, 16) : '');

/** Builds the overrides the API stores from the form: an empty cap is "plan default" and is left out. */
export function buildOverrides(
  limits: Record<string, string>,
  flags: Record<string, FlagChoice>,
  retention = '',
): PlanOverrides {
  const outLimits: Record<string, number> = {};
  for (const [k, v] of Object.entries(limits)) {
    const trimmed = v.trim();
    if (trimmed === '' || !/^-?\d+$/.test(trimmed)) continue;
    outLimits[k] = Number(trimmed);
  }
  const outFlags: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(flags)) if (v !== 'default') outFlags[k] = v === 'on';
  const r = retention.trim();
  return {
    limits: outLimits,
    features: outFlags,
    dataRetentionDays: /^\d{1,4}$/.test(r) && Number(r) <= 3650 ? Number(r) : null,
  };
}

/**
 * Super admin: attach a plan to ONE workspace, set when it ends, and give that workspace its own caps and flags (they beat the plan's).
 * The form submits the row version the list gave it, so two operators cannot overwrite each other.
 */
export function AttachDialog({
  workspace,
  plans,
  onClose,
  onSaved,
}: {
  workspace: WorkspacePlan | null;
  plans: readonly PlanAdminItem[];
  onClose: () => void;
  onSaved: (saved: WorkspacePlan) => void;
}) {
  const t = useTranslations(`${NS}.operator.dialog`);
  const locale = useLocale();
  const tg = useTranslations(`${EDITOR}.limitGroups`);
  const tl = useTranslations(`${EDITOR}.limitKeys`);
  const th = useTranslations(`${EDITOR}.limitHints`);
  const tf = useTranslations(`${EDITOR}.featureKeys`);
  const [planSlug, setPlanSlug] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [neverEnds, setNeverEnds] = useState(false);
  const [trialEnd, setTrialEnd] = useState('');
  const [endTrial, setEndTrial] = useState(false);
  const [retention, setRetention] = useState('');
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Record<string, FlagChoice>>({});
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<string | null>(null);

  // Reset the form each time a different workspace opens.
  if (workspace && seen !== workspace.workspaceId) {
    setSeen(workspace.workspaceId);
    setPlanSlug(workspace.planSlug);
    setEndsAt(toInput(workspace.validity.planEndsAt));
    setNeverEnds(false);
    setTrialEnd(toInput(workspace.validity.trialEndsAt));
    setEndTrial(false);
    setRetention(
      workspace.overrides.dataRetentionDays === null
        ? ''
        : String(workspace.overrides.dataRetentionDays),
    );
    setLimits(
      Object.fromEntries(
        Object.entries(workspace.overrides.limits).map(([k, v]) => [k, String(v)]),
      ),
    );
    setFlags(
      Object.fromEntries(
        Object.entries(workspace.overrides.features).map(([k, v]) => [k, v ? 'on' : 'off']),
      ) as Record<string, FlagChoice>,
    );
    setError(null);
  }
  if (!workspace && seen !== null) setSeen(null);

  const save = useMutation({
    mutationFn: () => {
      const w = workspace!;
      const endChanged = endsAt !== toInput(w.validity.planEndsAt);
      return attachWorkspacePlan(w.workspaceId, {
        planSlug,
        rowVersion: w.rowVersion,
        overrides: buildOverrides(limits, flags, retention),
        ...(endTrial
          ? { trialEndsAt: null }
          : trialEnd !== toInput(w.validity.trialEndsAt) && trialEnd
            ? { trialEndsAt: new Date(trialEnd).toISOString() }
            : {}),
        ...(neverEnds
          ? { planEndsAt: null }
          : endChanged && endsAt
            ? { planEndsAt: new Date(endsAt).toISOString() }
            : {}),
      });
    },
    onSuccess: (saved) => onSaved(saved),
    onError: (err) =>
      setError(
        err instanceof ApiError && err.isRowVersionConflict
          ? t('conflict')
          : err instanceof ApiError
            ? err.message
            : t('failed'),
      ),
  });

  const changing = workspace !== null && planSlug !== workspace.planSlug;
  return (
    <Modal
      open={workspace !== null}
      onClose={() => !save.isPending && onClose()}
      size="lg"
      title={workspace ? t('title', { name: workspace.name }) : ''}
      footer={
        <>
          <Button variant="secondary" disabled={save.isPending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button disabled={save.isPending || !planSlug} onClick={() => save.mutate()}>
            {save.isPending ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      {workspace && (
        <div className="space-y-5 text-sm">
          <label className="block space-y-1">
            <span className="font-medium">{t('plan')}</span>
            <Select
              value={planSlug}
              onChange={(e) => setPlanSlug(e.target.value)}
              data-testid="attach-plan"
            >
              {plans.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
              {!plans.some((p) => p.slug === workspace.planSlug) && (
                <option value={workspace.planSlug}>{workspace.planSlug}</option>
              )}
            </Select>
            {changing && <p className="text-muted-foreground">{t('changesTrial')}</p>}
          </label>

          <div className="space-y-1">
            <label className="block font-medium" htmlFor="attach-ends">
              {t('endsAt')}
            </label>
            <Input
              id="attach-ends"
              type="datetime-local"
              value={endsAt}
              disabled={neverEnds}
              onChange={(e) => setEndsAt(e.target.value)}
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={neverEnds}
                onChange={(e) => setNeverEnds(e.target.checked)}
              />
              {t('neverEnds')}
            </label>
            <p className="text-muted-foreground">{t('endsHint')}</p>
          </div>

          <div className="space-y-1">
            <label className="block font-medium" htmlFor="attach-trial">
              {t('trialEnd')}
            </label>
            <Input
              id="attach-trial"
              type="datetime-local"
              value={trialEnd}
              disabled={endTrial}
              onChange={(e) => setTrialEnd(e.target.value)}
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={endTrial}
                onChange={(e) => setEndTrial(e.target.checked)}
              />
              {t('endTrialNow')}
            </label>
            <p className="text-muted-foreground">{t('trialHint')}</p>
          </div>

          <label className="block space-y-1">
            <span className="font-medium">{t('retention')}</span>
            <Input
              inputMode="numeric"
              value={retention}
              placeholder={t('retentionPlaceholder')}
              onChange={(e) => setRetention(e.target.value)}
              data-testid="override-retention"
            />
            <span className="text-muted-foreground">{t('retentionHint')}</span>
          </label>

          <AddonsSection addons={workspace.addons} locale={locale} />

          <fieldset className="space-y-4">
            <legend className="font-medium">{t('limits')}</legend>
            <p className="text-muted-foreground">{t('limitsHint')}</p>
            {limitGroups().map(({ group, keys }) => (
              <div key={group} className="space-y-2" data-testid={`limit-group-${group}`}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {tg(group)}
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  {keys.map((key) => {
                    const raw = limits[key] ?? '';
                    const state = limitRowState(key, raw);
                    const plan = planValueView(key, workspace.planLimits[key]);
                    const planText =
                      plan.kind === 'unlimited'
                        ? t('unlimited')
                        : plan.kind === 'platformDefault'
                          ? t('platformDefault')
                          : String(plan.value);
                    return (
                      <div
                        key={key}
                        className="min-w-0 space-y-1.5 rounded-lg border border-border p-3"
                        data-testid={`limit-row-${key}`}
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                          <label htmlFor={`limit-${key}`} className="font-medium">
                            {tl(key)}
                          </label>
                          <span className="text-xs text-muted-foreground">
                            {t('planLimit', { value: planText })}
                          </span>
                        </div>
                        <Input
                          id={`limit-${key}`}
                          inputMode="numeric"
                          value={raw}
                          placeholder={planText}
                          onChange={(e) => setLimits((s) => ({ ...s, [key]: e.target.value }))}
                          data-testid={`limit-${key}`}
                        />
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <label className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={state.unlimited}
                              onChange={(e) =>
                                setLimits((s) => ({
                                  ...s,
                                  [key]: unlimitedToggle(e.target.checked),
                                }))
                              }
                              data-testid={`unlimited-${key}`}
                            />
                            {t('unlimited')}
                          </label>
                          {state.platformDefault && (
                            <Badge tone="neutral">{t('platformDefault')}</Badge>
                          )}
                        </div>
                        <p className="break-words text-xs text-muted-foreground">{th(key)}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="font-medium">{t('features')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {PLAN_FEATURE_KEYS.map((key) => (
                <label key={key} className="min-w-0 space-y-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span>{tf(key)}</span>
                    <span className="text-xs text-muted-foreground">
                      {t('planLimit', { value: workspace.planFeatures[key] ? t('on') : t('off') })}
                    </span>
                  </span>
                  <Select
                    value={flags[key] ?? 'default'}
                    onChange={(e) =>
                      setFlags((s) => ({ ...s, [key]: e.target.value as FlagChoice }))
                    }
                  >
                    <option value="default">{t('featureDefault')}</option>
                    <option value="on">{t('featureOn')}</option>
                    <option value="off">{t('featureOff')}</option>
                  </Select>
                </label>
              ))}
            </div>
          </fieldset>

          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      )}
    </Modal>
  );
}

/** The workspace's Marketplace add-ons: what its plan makes visible (owned or not) and what it owns that the plan no longer shows. */
function AddonsSection({ addons, locale }: { addons: WorkspacePlan['addons']; locale: string }) {
  const ta = useTranslations(`${NS}.operator.dialog.addons`);
  const timeZone = useTimeZone();
  const { visible, former } = addonLists(addons);
  const date = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium' }).format(new Date(iso))
      : null;
  return (
    <section className="space-y-3" data-testid="workspace-addons">
      <div>
        <h3 className="font-medium">{ta('title')}</h3>
        <p className="text-muted-foreground">{ta('hint')}</p>
      </div>
      {visible.length === 0 ? (
        <p className="text-muted-foreground">{ta('none')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {visible.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2"
              data-testid={`addon-visible-${a.app.slug}`}
            >
              <Link
                href={`/admin/marketplace/${encodeURIComponent(a.app.slug)}`}
                className="min-w-0 break-words font-medium text-primary hover:underline"
              >
                {a.app.name}
              </Link>
              <Badge tone={a.owned ? 'success' : 'neutral'}>
                {a.owned ? ta('owned') : ta('notOwned')}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {former.length > 0 && (
        <div className="space-y-2" data-testid="workspace-addons-former">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {ta('formerTitle')}
          </h4>
          <p className="text-xs text-muted-foreground">{ta('formerHint')}</p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {former.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2"
                data-testid={`addon-former-${o.app.slug}`}
              >
                <Link
                  href={`/admin/marketplace/${encodeURIComponent(o.app.slug)}`}
                  className="min-w-0 break-words font-medium text-primary hover:underline"
                >
                  {o.app.name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {o.endsAt ? ta('endsOn', { date: date(o.endsAt) ?? '' }) : ta('noEnd')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
