'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import {
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  type PlanAdminItem,
  type PlanOverrides,
  type WorkspacePlan,
} from '@crm/contracts';
import { Alert, Button, Input, Modal, Select } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { attachWorkspacePlan } from '../api';

const NS = 'plans-subscriptions-trials';
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
  const tl = useTranslations(`${NS}.limits`);
  const tf = useTranslations(`${NS}.features`);
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

          <fieldset className="space-y-2">
            <legend className="font-medium">{t('limits')}</legend>
            <p className="text-muted-foreground">{t('limitsHint')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {PLAN_LIMIT_KEYS.map((key) => (
                <label key={key} className="space-y-1">
                  <span>{tl(key)}</span>
                  <Input
                    inputMode="numeric"
                    value={limits[key] ?? ''}
                    placeholder={t('planLimit', {
                      value: String(workspace.planLimits[key] || '∞'),
                    })}
                    onChange={(e) => setLimits((s) => ({ ...s, [key]: e.target.value }))}
                    data-testid={`limit-${key}`}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="font-medium">{t('features')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {PLAN_FEATURE_KEYS.map((key) => (
                <label key={key} className="space-y-1">
                  <span>{tf(key)}</span>
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
