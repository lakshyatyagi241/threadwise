'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import type { HandoffSettings, UpdateHandoffSettingsInput } from '@crm/contracts';
import { Alert, Badge, Input, Spinner, Switch, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { AddonLockLink } from '@/features/plans-subscriptions-trials/components/addon-lock';
import { ApiError } from '@/lib/api/errors';
import {
  KEYS,
  routingApi,
  useHandoffSettings,
  useRoutingSettings,
  useUpdateHandoffSettings,
} from '../api/routing';

/**
 * The top of `/auto-assignment` (spec H13 to H20): four plain switches in the owner's own wording, with the order they run in. They map to
 * what the engine does and nothing else:
 *  1. Auto Assignment = the workspace's `autoAssign` switch (arrival routing and the "assignment rules" handoff destination);
 *  2. Sticky Agent = "keep returning contacts with their agent" (`keepContactAgent`: the contact owner, else the last handler);
 *  3. Assign Chat to Contact Owner = the owner mode is not `independent` (owner first);
 *  4. Assign Agent as Contact Owner = `claimSetsOwner` (a claim sets the owner when the contact has none).
 * The extras (keep in sync, the sticky window, the reassign prompt, the queue alert) sit under Advanced.
 * `onAutoEnabled` lets the page create the "Everyone else: distribute evenly" row when the admin turns Auto Assignment on and the workspace
 * has no such row yet; nothing is ever created at deploy time.
 */
export function AssignmentSwitches({ onAutoEnabled }: { onAutoEnabled: () => Promise<void> }) {
  const t = useTranslations('team-inbox-routing-sla.assign.switches');
  const ta = useTranslations('team-inbox-routing-sla.assign.advanced');
  const th = useTranslations('team-inbox-routing-sla.handoffSettings');
  const canRead = useCan('inbox.settings.read');
  const canManage = useCan('inbox.routing.manage');
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useHandoffSettings(canRead);
  const save = useUpdateHandoffSettings();
  const data = q.data;
  const keepQuery = useRoutingSettings(canRead && data?.available.autoAssign === true);
  const [keepBusy, setKeepBusy] = useState(false);

  const failed = (e: unknown) =>
    toast(e instanceof ApiError && e.message ? e.message : t('saveFailed'), 'danger');
  const change = (patch: UpdateHandoffSettingsInput, after?: () => Promise<void>) =>
    save.mutate(patch, {
      onSuccess: () => {
        toast(t('saved'));
        if (after) after().catch(failed);
      },
      onError: failed,
    });

  async function setKeep(on: boolean) {
    setKeepBusy(true);
    try {
      await routingApi.updateSettings(on);
      await qc.invalidateQueries({ queryKey: KEYS.settings });
      toast(t('saved'));
    } catch (e) {
      failed(e);
    } finally {
      setKeepBusy(false);
    }
  }

  if (q.isPending) {
    return (
      <div className="flex justify-center p-8" role="status" aria-label={t('loading')}>
        <Spinner />
      </div>
    );
  }
  if (q.isError || !data) {
    return (
      <Alert tone="danger">
        {t('loadFailed')}{' '}
        <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>
          {t('retry')}
        </button>
      </Alert>
    );
  }

  const busy = save.isPending;
  const off = !data.autoAssign;
  const ownerOn = data.ownerMode !== 'independent';
  const stickyOn = keepQuery.data?.keepContactAgent ?? false;
  const planAuto = data.available.autoAssign;

  return (
    <section
      className="space-y-4"
      data-testid="assignment-switches"
      aria-labelledby="switches-title"
    >
      <div>
        <h2 id="switches-title" className="text-lg font-semibold">
          {t('title')}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('intro')}</p>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground" data-testid="switch-order">
          {t('order')}
        </p>
      </div>
      {!canManage && <Alert tone="info">{t('readOnly')}</Alert>}

      <div className="divide-y divide-border rounded-xl border border-border bg-background">
        <SwitchRow
          id="auto"
          step={t('stepMaster')}
          title={t('auto.title')}
          locked={!planAuto}
          lockedText={[t('notInPlan'), t('upgradeHint')]}
          control={
            <Switch
              label={t('auto.title')}
              checked={data.autoAssign}
              disabled={!canManage || busy || !planAuto}
              onCheckedChange={(on) => change({ autoAssign: on }, on ? onAutoEnabled : undefined)}
            />
          }
        >
          <p>{t('auto.body')}</p>
          <p className="mt-1 text-xs">
            {t.rich('auto.limitHint', {
              link: (chunks) => (
                <Link href="/team-members" className="font-medium text-primary hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
          {off && planAuto && <p className="mt-1 text-xs text-warning">{t('auto.off')}</p>}
        </SwitchRow>

        <SwitchRow
          id="sticky"
          step={t('stepFirst')}
          title={t('sticky.title')}
          locked={!planAuto}
          lockedText={[t('notInPlan'), t('upgradeHint')]}
          dimmed={off && planAuto}
          control={
            <Switch
              label={t('sticky.title')}
              checked={stickyOn}
              disabled={!canManage || keepBusy || !planAuto || keepQuery.isPending}
              onCheckedChange={(on) => void setKeep(on)}
            />
          }
        >
          <p>{t('sticky.body')}</p>
          <p className="mt-1 text-xs">{t('sticky.withWindow')}</p>
          {off && planAuto && <p className="mt-1 text-xs">{t('needsAuto')}</p>}
        </SwitchRow>

        <SwitchRow
          id="owner"
          step={t('stepFirst')}
          title={t('owner.title')}
          locked={!data.available.ownerFirst}
          lockedText={[t('notInPlan'), t('upgradeHint')]}
          dimmed={off && planAuto}
          control={
            <Switch
              label={t('owner.title')}
              checked={ownerOn}
              disabled={!canManage || busy || !data.available.ownerFirst}
              onCheckedChange={(on) => change({ ownerMode: on ? 'owner_first' : 'independent' })}
            />
          }
        >
          <p>{t('owner.body')}</p>
          <p className="mt-1 text-xs">{t('owner.wins')}</p>
          {off && planAuto && <p className="mt-1 text-xs">{t('needsAuto')}</p>}
        </SwitchRow>

        <SwitchRow
          id="claim"
          step={t('stepAfter')}
          title={t('claim.title')}
          control={
            <Switch
              label={t('claim.title')}
              checked={data.claimSetsOwner}
              disabled={!canManage || busy}
              onCheckedChange={(on) => change({ claimSetsOwner: on })}
            />
          }
        >
          <p>{t('claim.body')}</p>
          <p className="mt-1 text-xs">{t('claim.note')}</p>
        </SwitchRow>
      </div>

      <details className="rounded-xl border border-border bg-background" data-testid="advanced">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold">
          {ta('title')}
          <span className="ms-2 text-xs font-normal text-muted-foreground">{ta('hint')}</span>
        </summary>
        <div className="space-y-4 border-t border-border p-4">
          <AdvancedRow
            title={ta('sync.title')}
            hint={ta('sync.body')}
            extra={ownerOn ? null : ta('sync.needsOwner')}
            locked={!data.available.keepInSync}
            notInPlan={th('notInPlan')}
            upgrade={th('upgradeHint')}
            control={
              <Switch
                label={ta('sync.title')}
                checked={data.ownerMode === 'keep_in_sync'}
                disabled={!canManage || busy || !data.available.keepInSync || !ownerOn}
                onCheckedChange={(on) => change({ ownerMode: on ? 'keep_in_sync' : 'owner_first' })}
              />
            }
          />
          <ContinuityRow
            key={String(data.continuityDays)}
            settings={data}
            disabled={!canManage || busy}
            onChange={(days) => change({ continuityDays: days })}
          />
          <AdvancedRow
            title={th('owner.prompt')}
            hint={th('owner.promptHint')}
            locked={!data.available.promptOwnerOnReassign}
            notInPlan={th('notInPlan')}
            upgrade={th('upgradeHint')}
            control={
              <Switch
                label={th('owner.prompt')}
                checked={data.promptOwnerOnReassign}
                disabled={!canManage || busy || !data.available.promptOwnerOnReassign}
                onCheckedChange={(on) => change({ promptOwnerOnReassign: on })}
              />
            }
          />
          <AdvancedRow
            title={th('queue.notify')}
            hint={th('queue.notifyHint')}
            control={
              <Switch
                label={th('queue.notify')}
                checked={data.notifyQueue}
                disabled={!canManage || busy}
                onCheckedChange={(on) => change({ notifyQueue: on })}
              />
            }
          />
          <p className="text-sm text-muted-foreground">
            {th('teams.body')}{' '}
            <Link href="/teams" className="font-medium text-primary hover:underline">
              {th('teams.link')}
            </Link>
          </p>
        </div>
      </details>
    </section>
  );
}

function SwitchRow({
  id,
  step,
  title,
  locked,
  lockedText,
  dimmed,
  control,
  children,
}: {
  id: string;
  step: string;
  title: string;
  locked?: boolean;
  lockedText?: [string, string];
  dimmed?: boolean;
  control: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-4 p-4 ${dimmed ? 'opacity-70' : ''}`}
      data-testid={`switch-${id}`}
    >
      <div className="min-w-0 max-w-2xl text-sm text-muted-foreground">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
          {title}
          <Badge tone="neutral">{step}</Badge>
          {locked && lockedText && <Badge tone="warning">{lockedText[0]}</Badge>}
        </p>
        <div className="mt-1">{children}</div>
        {locked && lockedText && (
          <p className="mt-1 text-xs text-warning" data-testid={`switch-${id}-lock`}>
            {lockedText[1]} <AddonLockLink />
          </p>
        )}
      </div>
      {control}
    </div>
  );
}

function AdvancedRow({
  title,
  hint,
  extra,
  locked,
  notInPlan,
  upgrade,
  control,
}: {
  title: string;
  hint: string;
  extra?: string | null;
  locked?: boolean;
  notInPlan?: string;
  upgrade?: string;
  control: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-xl">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {title}
          {locked && notInPlan && <Badge tone="warning">{notInPlan}</Badge>}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        {extra && <p className="mt-0.5 text-xs text-muted-foreground">{extra}</p>}
        {locked && upgrade && (
          <p className="mt-0.5 text-xs text-warning">
            {upgrade} <AddonLockLink />
          </p>
        )}
      </div>
      {control}
    </div>
  );
}

/** "Keep a returning contact with the person who handled their last chat, for N days": off = no limit (today's behaviour). */
function ContinuityRow({
  settings,
  disabled,
  onChange,
}: {
  settings: HandoffSettings;
  disabled: boolean;
  onChange: (days: number | null) => void;
}) {
  const th = useTranslations('team-inbox-routing-sla.handoffSettings');
  const locked = !settings.available.continuityWindow;
  const saved = settings.continuityDays;
  const [text, setText] = useState(saved === null ? '' : String(saved));
  const commit = () => {
    const n = Number.parseInt(text, 10);
    if (!Number.isFinite(n)) return;
    const days = Math.min(365, Math.max(1, n));
    setText(String(days));
    if (days !== saved) onChange(days);
  };
  return (
    <AdvancedRow
      title={th('owner.window')}
      hint={th('owner.windowHint')}
      locked={locked}
      notInPlan={th('notInPlan')}
      upgrade={th('upgradeHint')}
      control={
        <span className="flex items-center gap-2">
          <Switch
            label={th('owner.window')}
            checked={saved !== null}
            disabled={disabled || locked}
            onCheckedChange={(on) => onChange(on ? 30 : null)}
          />
          {saved !== null && (
            <span className="flex items-center gap-1.5 text-sm">
              <Input
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                aria-label={th('owner.windowDays')}
                data-testid="handoff-continuity-days"
                className="h-9 w-20"
                value={text}
                disabled={disabled || locked}
                onChange={(e) => setText(e.target.value)}
                onBlur={commit}
              />
              {th('owner.days')}
            </span>
          )}
        </span>
      }
    />
  );
}
