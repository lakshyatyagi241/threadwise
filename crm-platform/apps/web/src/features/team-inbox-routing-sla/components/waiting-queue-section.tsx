'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import type { HandoffSettings } from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  Select,
  Spinner,
  Switch,
  Textarea,
  useToast,
} from '@crm/ui';
import { AddonLockLink } from '@/features/plans-subscriptions-trials/components/addon-lock';
import { ApiError } from '@/lib/api/errors';
import { useUpdateHandoffSettings } from '../api/routing';
import {
  formFromTimers,
  queueProblems,
  sameForm,
  toAwayInput,
  toQueueInput,
  type QueueForm,
  type QueueProblem,
} from '../lib/queue-timers-form';

/**
 * Auto-assignment > Waiting queue: three optional steps for a chat nobody has taken (a reminder, an offer to another team, and a last step:
 * a message to the customer or the chat given back to the bot). Part of Smart routing (`available.queueTimers`): without it the whole
 * section is shown locked with the add-on named and linked, never hidden. Every step is off by default; one Save button, because the steps
 * depend on each other (a team to offer to, a text to send), and the server refuses an incomplete step with the field.
 */
export function WaitingQueueSection({
  settings,
  teams,
  canManage,
}: {
  settings: HandoffSettings;
  teams: ReadonlyArray<{ id: string; name: string }>;
  canManage: boolean;
}) {
  const t = useTranslations('team-inbox-routing-sla.waitingQueue');
  const th = useTranslations('team-inbox-routing-sla.handoffSettings');
  const { toast } = useToast();
  const save = useUpdateHandoffSettings();
  const locked = !settings.available.queueTimers;
  const stored = formFromTimers(settings.queueTimers, settings.away);
  const [form, setForm] = useState<QueueForm>(stored);
  const [tried, setTried] = useState(false);
  const patch = (p: Partial<QueueForm>) => setForm((f) => ({ ...f, ...p }));
  const problems = queueProblems(form);
  const has = (p: QueueProblem) => tried && problems.includes(p);
  const dirty = !sameForm(form, stored);
  const disabled = locked || !canManage || save.isPending;

  const submit = () => {
    setTried(true);
    if (problems.length > 0) return;
    save.mutate(
      { queueTimers: toQueueInput(form), away: toAwayInput(form) },
      {
        onSuccess: () => {
          setTried(false);
          toast(t('saved'));
        },
        onError: (e) =>
          toast(e instanceof ApiError && e.message ? e.message : t('saveFailed'), 'danger'),
      },
    );
  };

  const minutes = (
    key: 'remindMinutes' | 'overflowMinutes' | 'finalMinutes' | 'autoOfflineMinutes',
    bad: boolean,
  ) => (
    <Field label={t('afterMinutes')} error={bad ? t('problems.minutes') : undefined}>
      <Input
        type="number"
        min={1}
        max={1440}
        inputMode="numeric"
        className="w-28"
        value={form[key]}
        disabled={disabled}
        onChange={(e) => patch({ [key]: e.target.value } as Partial<QueueForm>)}
      />
    </Field>
  );

  return (
    <section className="space-y-4" data-testid="waiting-queue" aria-labelledby="wq-title">
      <div>
        <h2 id="wq-title" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          {t('title')}
          {locked && <Badge tone="warning">{th('notInPlan')}</Badge>}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('intro')}</p>
        {locked && (
          <p className="mt-1 text-xs text-warning" data-testid="waiting-queue-lock">
            {th('upgradeHint')} <AddonLockLink />
          </p>
        )}
      </div>
      {!canManage && !locked && <Alert tone="info">{t('readOnly')}</Alert>}

      <div className="divide-y divide-border rounded-xl border border-border bg-background">
        <StepRow
          id="remind"
          title={t('remind')}
          body={t('remindBody')}
          on={form.remind}
          disabled={disabled}
          onChange={(remind) => patch({ remind })}
        >
          {minutes('remindMinutes', has('remindMinutes'))}
        </StepRow>

        <StepRow
          id="overflow"
          title={t('overflow')}
          body={t('overflowBody')}
          on={form.overflow}
          disabled={disabled}
          onChange={(overflow) => patch({ overflow })}
        >
          {minutes('overflowMinutes', has('overflowMinutes'))}
          <Field label={t('team')} error={has('overflowTeam') ? t('problems.team') : undefined}>
            <Select
              value={form.overflowTeamId}
              disabled={disabled}
              onChange={(e) => patch({ overflowTeamId: e.target.value })}
            >
              <option value="">{t('teamPick')}</option>
              {teams.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
        </StepRow>

        <StepRow
          id="final"
          title={t('final')}
          body={t('finalBody')}
          on={form.final}
          disabled={disabled}
          onChange={(final) => patch({ final })}
        >
          {minutes('finalMinutes', has('finalMinutes'))}
          <Field label={t('action')}>
            <Select
              value={form.finalAction}
              disabled={disabled}
              onChange={(e) => patch({ finalAction: e.target.value as QueueForm['finalAction'] })}
            >
              <option value="message">{t('actionMessage')}</option>
              <option value="bot">{t('actionBot')}</option>
            </Select>
          </Field>
          {form.finalAction === 'message' && (
            <Field
              label={t('message')}
              hint={t('messageHint')}
              error={has('finalMessage') ? t('problems.message') : undefined}
            >
              <Textarea
                rows={3}
                maxLength={1000}
                value={form.message}
                disabled={disabled}
                onChange={(e) => patch({ message: e.target.value })}
              />
            </Field>
          )}
        </StepRow>
        <StepRow
          id="away"
          title={t('away')}
          body={t('awayBody')}
          on={form.returnAway}
          disabled={disabled}
          onChange={(returnAway) => patch({ returnAway })}
        >
          {null}
        </StepRow>

        <StepRow
          id="offline"
          title={t('offline')}
          body={t('offlineBody')}
          on={form.autoOffline}
          disabled={disabled}
          onChange={(autoOffline) => patch({ autoOffline })}
        >
          {minutes('autoOfflineMinutes', has('offlineMinutes'))}
        </StepRow>
      </div>

      {!locked && canManage && (
        <div className="flex justify-end">
          <Button disabled={save.isPending || !dirty} onClick={submit}>
            {save.isPending && <Spinner />}
            {t('save')}
          </Button>
        </div>
      )}
    </section>
  );
}

function StepRow({
  id,
  title,
  body,
  on,
  disabled,
  onChange,
  children,
}: {
  id: string;
  title: string;
  body: string;
  on: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 p-4" data-testid={`wq-${id}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
        </div>
        <Switch label={title} checked={on} disabled={disabled} onCheckedChange={onChange} />
      </div>
      {on && children !== null && <div className="grid gap-3 sm:grid-cols-2">{children}</div>}
    </div>
  );
}
