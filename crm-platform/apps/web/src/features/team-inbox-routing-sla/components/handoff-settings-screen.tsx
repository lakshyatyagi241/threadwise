'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { OWNER_MODES, type HandoffSettings, type OwnerMode } from '@crm/contracts';
import { Alert, Badge, Input, Spinner, Switch, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { useHandoffSettings, useUpdateHandoffSettings } from '../api/routing';

type Available = HandoffSettings['available'];

/** The plan capability each owner mode needs (`HANDOFF_GATES`): the mode shows a lock when the plan does not include it. */
const MODE_GATE: Record<OwnerMode, keyof Available | null> = {
  independent: null,
  owner_first: 'ownerFirst',
  keep_in_sync: 'keepInSync',
};

/**
 * `/assignment-settings` (Settings > Automation): how a conversation reaches a person once a bot, a flow or a teammate asks for one, and
 * how the contact's owner and the chat's owner relate (BL-396 to BL-404). Reading needs `inbox.settings.read`, changing
 * `inbox.routing.manage`. Open to every plan: what a plan does not include shows a lock and says so, it is never a silent no-op.
 */
export function HandoffSettingsScreen() {
  const t = useTranslations('team-inbox-routing-sla.handoffSettings');
  const { toast } = useToast();
  const canRead = useCan('inbox.settings.read');
  const canManage = useCan('inbox.routing.manage');
  const q = useHandoffSettings(canRead);
  const save = useUpdateHandoffSettings();
  const data = q.data;

  const change = (patch: Parameters<typeof save.mutate>[0]) =>
    save.mutate(patch, {
      onSuccess: () => toast(t('saved')),
      onError: (e) =>
        toast(e instanceof ApiError && e.message ? e.message : t('saveFailed'), 'danger'),
    });

  if (!canRead) {
    return (
      <section className="mx-auto max-w-3xl">
        <Alert tone="warning">{t('noAccess')}</Alert>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6" data-testid="handoff-settings">
      <header>
        <Link
          href="/settings/automation"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {t('back')}
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {q.isPending && (
        <div className="flex justify-center p-10" role="status" aria-label={t('loading')}>
          <Spinner />
        </div>
      )}
      {q.isError && (
        <Alert tone="danger">
          {t('loadFailed')}{' '}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => void q.refetch()}
          >
            {t('retry')}
          </button>
        </Alert>
      )}

      {data && (
        <>
          {!canManage && <Alert tone="info">{t('readOnly')}</Alert>}

          <Card title={t('auto.title')} body={t('auto.body')}>
            <Row
              title={t('auto.switch')}
              hint={t('auto.switchHint')}
              locked={!data.available.autoAssign}
              control={
                <Switch
                  label={t('auto.switch')}
                  checked={data.autoAssign}
                  disabled={!canManage || save.isPending || !data.available.autoAssign}
                  onCheckedChange={(on) => change({ autoAssign: on })}
                />
              }
            />
          </Card>

          <Card title={t('owner.title')} body={t('owner.body')}>
            <fieldset className="space-y-2" disabled={!canManage || save.isPending}>
              <legend className="sr-only">{t('owner.modeLabel')}</legend>
              {OWNER_MODES.map((mode) => {
                const gate = MODE_GATE[mode];
                const locked = gate !== null && !data.available[gate];
                return (
                  <label
                    key={mode}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                      data.ownerMode === mode ? 'border-primary bg-primary/5' : 'border-border'
                    } ${locked ? 'opacity-60' : ''}`}
                  >
                    <input
                      type="radio"
                      name="owner-mode"
                      data-testid={`handoff-owner-mode-${mode}`}
                      className="mt-1"
                      checked={data.ownerMode === mode}
                      disabled={locked}
                      onChange={() => change({ ownerMode: mode })}
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {t(`owner.modes.${mode}.title`)}
                        {locked && <Badge tone="warning">{t('notInPlan')}</Badge>}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t(`owner.modes.${mode}.body`)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <Row
              title={t('owner.claimSets')}
              hint={t('owner.claimSetsHint')}
              control={
                <Switch
                  label={t('owner.claimSets')}
                  checked={data.claimSetsOwner}
                  disabled={!canManage || save.isPending}
                  onCheckedChange={(on) => change({ claimSetsOwner: on })}
                />
              }
            />
            <Row
              title={t('owner.prompt')}
              hint={t('owner.promptHint')}
              locked={!data.available.promptOwnerOnReassign}
              control={
                <Switch
                  label={t('owner.prompt')}
                  checked={data.promptOwnerOnReassign}
                  disabled={!canManage || save.isPending || !data.available.promptOwnerOnReassign}
                  onCheckedChange={(on) => change({ promptOwnerOnReassign: on })}
                />
              }
            />
            <ContinuityRow
              key={String(data.continuityDays)}
              settings={data}
              disabled={!canManage || save.isPending}
              onChange={(days) => change({ continuityDays: days })}
            />
          </Card>

          <Card title={t('queue.title')} body={t('queue.body')}>
            <Row
              title={t('queue.notify')}
              hint={t('queue.notifyHint')}
              control={
                <Switch
                  label={t('queue.notify')}
                  checked={data.notifyQueue}
                  disabled={!canManage || save.isPending}
                  onCheckedChange={(on) => change({ notifyQueue: on })}
                />
              }
            />
          </Card>

          <Card title={t('teams.title')} body={t('teams.body')}>
            <Link href="/teams" className="text-sm font-medium text-primary hover:underline">
              {t('teams.link')}
            </Link>
          </Card>
        </>
      )}
    </section>
  );
}

function Card({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{body}</p>
      </div>
      {children}
    </div>
  );
}

function Row({
  title,
  hint,
  control,
  locked,
}: {
  title: string;
  hint: string;
  control: ReactNode;
  locked?: boolean;
}) {
  const t = useTranslations('team-inbox-routing-sla.handoffSettings');
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-xl">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {title}
          {locked && <Badge tone="warning">{t('notInPlan')}</Badge>}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        {locked && <p className="mt-0.5 text-xs text-warning">{t('upgradeHint')}</p>}
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
  const t = useTranslations('team-inbox-routing-sla.handoffSettings');
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
    <Row
      title={t('owner.window')}
      hint={t('owner.windowHint')}
      locked={locked}
      control={
        <span className="flex items-center gap-2">
          <Switch
            label={t('owner.window')}
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
                aria-label={t('owner.windowDays')}
                data-testid="handoff-continuity-days"
                className="h-9 w-20"
                value={text}
                disabled={disabled || locked}
                onChange={(e) => setText(e.target.value)}
                onBlur={commit}
              />
              {t('owner.days')}
            </span>
          )}
        </span>
      }
    />
  );
}
