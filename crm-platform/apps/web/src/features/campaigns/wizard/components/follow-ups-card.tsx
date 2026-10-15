'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  WIZARD_FOLLOW_UP_MAX,
  WIZARD_FOLLOW_UP_TRIGGERS,
  type WizardFollowUp,
  type WizardFollowUpTrigger,
} from '@crm/contracts';
import { Alert, Button, Field, Input, Select } from '@crm/ui';
import {
  WAIT_UNITS,
  amountIn,
  canAddFollowUp,
  followUpIndexOf,
  maxAmount,
  newFollowUp,
  supportsFollowUps,
  toMinutes,
  unitOf,
  type WaitUnit,
} from '../lib/follow-ups';
import { issueFor, type StepIssue } from '../lib/issues';
import { WizardCard } from './parts';
import type { TemplatesQuery } from './template-picker';

export interface FlowsQuery {
  data: ReadonlyArray<{ id: string; name: string }> | undefined;
  isPending: boolean;
  isError: boolean;
}

/** "5 minutes", "2 hours", "1 day": a wait in the largest whole unit (for the review and the card's own lines). */
export function useWaitText(): (minutes: number) => string {
  const t = useTranslations('campaigns.wizard.followUps');
  return (minutes) => {
    const unit = unitOf(minutes);
    return t(`duration.${unit}`, { count: amountIn(minutes, unit) });
  };
}

/** The number and unit of a wait: the number is kept as typed (even empty) and the contract's minutes follow it. */
function WaitField({
  id,
  waitMinutes,
  disabled,
  label,
  onMinutes,
}: {
  id: string;
  waitMinutes: number;
  disabled?: boolean;
  label: string;
  onMinutes: (m: number) => void;
}) {
  const t = useTranslations('campaigns.wizard.followUps');
  const [unit, setUnit] = useState<WaitUnit>(() => unitOf(waitMinutes));
  const [amount, setAmount] = useState(() => String(amountIn(waitMinutes, unit)));
  const count = Number(amount) || 1;

  const typed = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (digits === '') return setAmount('');
    const minutes = toMinutes(Number(digits), unit);
    setAmount(String(amountIn(minutes, unit)));
    onMinutes(minutes);
  };
  const unitChanged = (next: WaitUnit) => {
    const minutes = toMinutes(count, next);
    setUnit(next);
    setAmount(String(amountIn(minutes, next)));
    onMinutes(minutes);
  };
  return (
    <Field label={label} htmlFor={`${id}-amount`} className="min-w-0">
      <div className="flex gap-2">
        <Input
          id={`${id}-amount`}
          inputMode="numeric"
          autoComplete="off"
          value={amount}
          disabled={disabled}
          maxLength={String(maxAmount('minutes')).length}
          onChange={(e) => typed(e.target.value)}
          onBlur={() => amount === '' && setAmount(String(amountIn(waitMinutes, unit)))}
          className="w-24"
        />
        <Select
          value={unit}
          disabled={disabled}
          aria-label={t('unitLabel')}
          onChange={(e) => unitChanged(e.target.value as WaitUnit)}
          className="w-36"
        >
          {WAIT_UNITS.map((u) => (
            <option key={u} value={u}>
              {t(`unit.${u}`, { count })}
            </option>
          ))}
        </Select>
      </div>
    </Field>
  );
}

function FollowUpRow({
  index,
  step,
  followUp,
  templates,
  flows,
  issues,
  disabled,
  locked,
  onChange,
  onRemove,
}: {
  index: number;
  step: number;
  followUp: WizardFollowUp;
  templates: TemplatesQuery;
  flows: FlowsQuery;
  issues: StepIssue[];
  /** Everything is read only (the draft is being saved or was launched). */
  disabled?: boolean;
  /** The sender cannot have follow-ups: the step is only shown so it can be removed. */
  locked: boolean;
  onChange: (next: WizardFollowUp) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('campaigns.wizard.followUps');
  const ti = useTranslations('campaigns.wizard.issues');
  const uid = useId();
  const issue = issueFor(issues, `followUps.${index}.action`);
  const off = disabled || locked;
  const trigger = followUp.trigger;
  const watching = trigger === 'replied' || trigger === 'read';
  const { action } = followUp;

  const approved = templates.data?.data;
  const list = flows.data;
  const chosen = action.kind === 'template' ? action.templateId : action.flowId;
  const pickable = action.kind === 'template' ? approved : list;
  const missing =
    chosen !== null && pickable !== undefined && !pickable.some((x) => x.id === chosen);
  const loading = action.kind === 'template' ? templates.isPending : flows.isPending;
  const none = !loading && (pickable === undefined || pickable.length === 0);

  const kind = (k: 'template' | 'flow') => {
    if (k === action.kind) return;
    onChange({
      ...followUp,
      action:
        k === 'template' ? { kind: 'template', templateId: null } : { kind: 'flow', flowId: null },
    });
  };
  const pick = (id: string) =>
    onChange({
      ...followUp,
      action:
        action.kind === 'template'
          ? { kind: 'template', templateId: id || null }
          : { kind: 'flow', flowId: id || null },
    });

  return (
    <li className="space-y-3 rounded-lg border border-border p-3" data-testid="follow-up-row">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t('stepTitle', { step })}</h3>
          <p className="text-xs text-muted-foreground">
            {step === 1 ? t('measuredFromCampaign') : t('measuredFromStep', { step: step - 1 })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={t('remove', { step })}
          onClick={onRemove}
        >
          {t('removeShort')}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={t('triggerLabel')}
          htmlFor={`${uid}-trigger`}
          hint={t(`triggerHelp.${trigger}`)}
          className="min-w-0"
        >
          <Select
            id={`${uid}-trigger`}
            value={trigger}
            disabled={off}
            onChange={(e) =>
              onChange({ ...followUp, trigger: e.target.value as WizardFollowUpTrigger })
            }
          >
            {WIZARD_FOLLOW_UP_TRIGGERS.map((x) => (
              <option key={x} value={x}>
                {t(`trigger.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <WaitField
          id={uid}
          waitMinutes={followUp.waitMinutes}
          disabled={off}
          label={watching ? t('watchLabel') : t('waitLabel')}
          onMinutes={(waitMinutes) => onChange({ ...followUp, waitMinutes })}
        />
      </div>

      <fieldset className="space-y-2" disabled={off}>
        <legend className="text-sm font-medium">{t('actionLabel')}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {(['template', 'flow'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${uid}-kind`}
                checked={action.kind === k}
                onChange={() => kind(k)}
              />
              {t(`action.${k}`)}
            </label>
          ))}
        </div>
        {none ? (
          <p className="text-xs text-muted-foreground">
            {action.kind === 'template' ? t('noTemplates') : t('noFlows')}{' '}
            <Link
              href={action.kind === 'template' ? '/templates' : '/flows'}
              className="font-semibold text-brand hover:underline"
            >
              {action.kind === 'template' ? t('createTemplate') : t('createFlow')}
            </Link>
          </p>
        ) : (
          <>
            <Select
              value={chosen ?? ''}
              invalid={Boolean(issue)}
              aria-label={action.kind === 'template' ? t('templateLabel') : t('flowLabel')}
              disabled={off || loading}
              onChange={(e) => pick(e.target.value)}
            >
              <option value="">
                {loading
                  ? t('loading')
                  : action.kind === 'template'
                    ? t('pickTemplate')
                    : t('pickFlow')}
              </option>
              {missing && chosen && <option value={chosen}>{t('unavailable')}</option>}
              {action.kind === 'template'
                ? approved?.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({x.language})
                    </option>
                  ))
                : list?.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
            </Select>
            {action.kind === 'flow' && flows.isError && (
              <p role="alert" className="text-xs text-danger">
                {t('flowsError')}
              </p>
            )}
          </>
        )}
        {issue && (
          <p role="alert" className="text-xs text-danger">
            {ti(issue.code)}
          </p>
        )}
      </fieldset>
    </li>
  );
}

/**
 * "Follow-ups": up to three more messages (or flows) after the campaign message, each fired by what the recipient does or does not do.
 * Only a Cloud API number can have them (Meta's delivery reports tell us who read), so the card explains itself otherwise.
 */
export function FollowUpsCard({
  followUps,
  senderKey,
  templates,
  flows,
  issues,
  disabled,
  onFollowUps,
}: {
  followUps: readonly WizardFollowUp[];
  senderKey: string | null;
  templates: TemplatesQuery;
  flows: FlowsQuery;
  issues: StepIssue[];
  disabled?: boolean;
  onFollowUps: (next: WizardFollowUp[]) => void;
}) {
  const t = useTranslations('campaigns.wizard.followUps');
  const ti = useTranslations('campaigns.wizard.issues');
  const supported = supportsFollowUps(senderKey);
  const full = !canAddFollowUp(followUps);
  // Rows keep their wait box's own state; removing one bumps this so the rows below start from their own value.
  const [epoch, setEpoch] = useState(0);
  const listIssue = issueFor(issues, 'followUps');
  const set = (i: number, next: WizardFollowUp) =>
    onFollowUps(followUps.map((f, j) => (j === i ? next : f)));

  return (
    <WizardCard title={t('title')} hint={t('intro')} id="send-follow-ups">
      <div className="space-y-4">
        {!supported && (
          <Alert tone="info" className="text-sm">
            {t('cloudOnly')}
          </Alert>
        )}
        {listIssue && (
          <p role="alert" className="text-sm text-danger">
            {ti(listIssue.code)}
          </p>
        )}
        {followUps.length > 0 && (
          <ol className="space-y-3">
            {followUps.map((f, i) => (
              <FollowUpRow
                key={`${epoch}-${i}`}
                index={i}
                step={i + 1}
                followUp={f}
                templates={templates}
                flows={flows}
                issues={issues.filter((x) => followUpIndexOf(x.path) === i)}
                disabled={disabled}
                locked={!supported}
                onChange={(next) => set(i, next)}
                onRemove={() => {
                  setEpoch((n) => n + 1);
                  onFollowUps(followUps.filter((_, j) => j !== i));
                }}
              />
            ))}
          </ol>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={disabled || !supported || full}
            onClick={() => onFollowUps([...followUps, newFollowUp()])}
          >
            {t('add')}
          </Button>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {full
              ? t('limitReached', { max: WIZARD_FOLLOW_UP_MAX })
              : t('count', { used: followUps.length, max: WIZARD_FOLLOW_UP_MAX })}
          </span>
        </div>
      </div>
    </WizardCard>
  );
}
