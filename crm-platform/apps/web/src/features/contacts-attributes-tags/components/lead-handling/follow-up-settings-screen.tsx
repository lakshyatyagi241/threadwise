'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type {
  FollowUpDefaultDate,
  FollowUpSettings,
  FollowUpSettingsValues,
  LeadHandlingSettings,
} from '@crm/contracts';
import { Alert, Input, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import {
  LEAD_HANDLING_KEYS,
  leadHandlingApi,
  useLeadHandlingSettings,
} from '../../api/lead-handling';
import {
  RadioRow,
  SettingsFrame,
  SettingsPage,
  SettingsSection,
  ToggleRow,
  isVersionConflict,
  settingsErrorKey,
} from './settings-parts';

/** The preset choices of the default date; "custom" is any number of days that is not one of the presets. */
export type DateChoice = 'day' | 'three_days' | 'week' | 'month' | 'custom' | 'someday' | 'none';

const PRESET_DAYS: Record<'day' | 'three_days' | 'week', number> = {
  day: 1,
  three_days: 3,
  week: 7,
};

export function choiceOf(d: FollowUpDefaultDate): DateChoice {
  if (d.kind === 'month') return 'month';
  if (d.kind === 'someday') return 'someday';
  if (d.kind === 'none') return 'none';
  if (d.days === 1) return 'day';
  if (d.days === 3) return 'three_days';
  if (d.days === 7) return 'week';
  return 'custom';
}

export function dateOf(choice: DateChoice, customDays: number): FollowUpDefaultDate {
  switch (choice) {
    case 'day':
    case 'three_days':
    case 'week':
      return { kind: 'days', days: PRESET_DAYS[choice] };
    case 'custom':
      return { kind: 'days', days: Math.min(365, Math.max(1, Math.round(customDays) || 1)) };
    case 'month':
      return { kind: 'month' };
    case 'someday':
      return { kind: 'someday' };
    case 'none':
      return { kind: 'none' };
  }
}

export function valuesOf(s: FollowUpSettings | FollowUpSettingsValues): FollowUpSettingsValues {
  return {
    updateWhen: { ...s.updateWhen },
    defaultDate: { ...s.defaultDate },
    defaultTime: s.defaultTime,
  };
}

export const sameFollowUps = (a: FollowUpSettingsValues, b: FollowUpSettingsValues): boolean =>
  JSON.stringify(valuesOf(a)) === JSON.stringify(valuesOf(b));

const CHOICES: DateChoice[] = ['day', 'three_days', 'week', 'month', 'custom', 'someday', 'none'];

/** `/follow-ups`: when a contact action moves the follow-up, to which date, and at what time. */
export function FollowUpSettingsScreen() {
  const canManage = useCan('admin.settings.manage');
  const qc = useQueryClient();
  const q = useLeadHandlingSettings(canManage);
  const [conflict, setConflict] = useState(false);
  return (
    <SettingsFrame
      canManage={canManage}
      loading={!q.data && !q.isError}
      error={q.isError ? q.error : null}
      onRetry={() => void q.refetch()}
      conflict={conflict}
      onConflictOk={() => setConflict(false)}
    >
      {q.data && (
        <Body
          key={q.data.followUps.rowVersion ?? 'first'}
          settings={q.data.followUps}
          onSaved={() => setConflict(false)}
          onConflict={() => {
            setConflict(true);
            void qc.invalidateQueries({ queryKey: LEAD_HANDLING_KEYS.settings });
          }}
        />
      )}
    </SettingsFrame>
  );
}

function Body({
  settings,
  onSaved,
  onConflict,
}: {
  settings: FollowUpSettings;
  onSaved: () => void;
  onConflict: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.leadHandling.settings');
  const tf = useTranslations('contacts-attributes-tags.leadHandling.settings.followUps');
  const { toast } = useToast();
  const qc = useQueryClient();
  const baseline = valuesOf(settings);
  const [form, setForm] = useState<FollowUpSettingsValues>(baseline);
  const [choice, setChoice] = useState<DateChoice>(choiceOf(baseline.defaultDate));
  const [custom, setCustom] = useState<number>(
    baseline.defaultDate.kind === 'days' ? baseline.defaultDate.days : 10,
  );
  const [error, setError] = useState<unknown>(null);
  const value: FollowUpSettingsValues = { ...form, defaultDate: dateOf(choice, custom) };
  const dirty = !sameFollowUps(value, baseline);

  const saving = useRef(false);
  const save = useMutation({
    mutationFn: () =>
      leadHandlingApi.saveFollowUps({
        ...value,
        ...(settings.rowVersion === null ? {} : { rowVersion: settings.rowVersion }),
      }),
    onSuccess: (saved) => {
      qc.setQueryData(LEAD_HANDLING_KEYS.settings, (old: LeadHandlingSettings | undefined) =>
        old ? { ...old, followUps: saved } : old,
      );
      onSaved();
      toast(t('saved'), 'success');
    },
    onError: (e) => {
      if (isVersionConflict(e)) onConflict();
      else setError(e);
    },
    onSettled: () => {
      saving.current = false;
    },
  });
  const send = () => {
    if (saving.current) return;
    saving.current = true;
    setError(null);
    save.mutate();
  };
  const discard = () => {
    setForm(baseline);
    setChoice(choiceOf(baseline.defaultDate));
    setCustom(baseline.defaultDate.kind === 'days' ? baseline.defaultDate.days : 10);
  };

  const when = (key: keyof FollowUpSettingsValues['updateWhen']) => (v: boolean) =>
    setForm((f) => ({ ...f, updateWhen: { ...f.updateWhen, [key]: v } }));

  return (
    <SettingsPage
      title={tf('title')}
      subtitle={tf('subtitle')}
      dirty={dirty}
      saving={save.isPending}
      onSave={send}
      onDiscard={discard}
      error={
        error !== null ? (
          <Alert tone="danger" role="alert">
            {t(`errors.${settingsErrorKey(error)}`)}
          </Alert>
        ) : null
      }
    >
      <SettingsSection title={tf('when.title')} intro={tf('when.intro')}>
        <ToggleRow label={tf('when.none')} checked={form.updateWhen.none} onChange={when('none')} />
        <ToggleRow
          label={tf('when.overdue')}
          checked={form.updateWhen.overdue}
          onChange={when('overdue')}
        />
        <ToggleRow
          label={tf('when.today')}
          checked={form.updateWhen.today}
          onChange={when('today')}
        />
        <ToggleRow
          label={tf('when.future')}
          checked={form.updateWhen.future}
          onChange={when('future')}
        />
      </SettingsSection>

      <SettingsSection title={tf('date.title')} intro={tf('date.intro')}>
        {CHOICES.map((c) => (
          <div key={c}>
            <RadioRow
              name="follow-up-date"
              label={tf(`date.${c}`)}
              hint={
                c === 'someday'
                  ? tf('date.somedayHint')
                  : c === 'none'
                    ? tf('date.noneHint')
                    : undefined
              }
              checked={choice === c}
              onChange={() => setChoice(c)}
            />
            {c === 'custom' && choice === 'custom' && (
              <div className="ms-7 flex items-center gap-2 pb-2">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={custom}
                  aria-label={tf('date.customDays')}
                  className="w-24"
                  onChange={(e) => setCustom(Number(e.target.value))}
                />
                <span className="text-sm text-muted-foreground">{tf('date.daysLater')}</span>
              </div>
            )}
          </div>
        ))}
      </SettingsSection>

      <SettingsSection title={tf('time.title')} intro={tf('time.intro')}>
        <div className="py-1">
          <Input
            type="time"
            value={form.defaultTime}
            aria-label={tf('time.title')}
            className="w-36"
            onChange={(e) => {
              if (/^([01]\d|2[0-3]):[0-5]\d$/.test(e.target.value)) {
                setForm((f) => ({ ...f, defaultTime: e.target.value }));
              }
            }}
          />
          <p className="mt-2 text-xs text-muted-foreground">{tf('time.hint')}</p>
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
