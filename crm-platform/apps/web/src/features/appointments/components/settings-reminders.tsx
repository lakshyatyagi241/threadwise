'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Alert, Button, Spinner, useToast } from '@crm/ui';
import {
  KEYS,
  useAppointmentChannels,
  useBookingTypes,
  useMessageLibrary,
  useWaTemplates,
} from '../api/hooks';
import type { BookingType } from '../api/schemas';
import { appointmentsApi } from '../api/service';
import { errorKind } from '../lib/errors';
import {
  REMINDER_MAX_RULES,
  UNDELIVERED_MAX,
  UNDELIVERED_MIN,
  remindersChanged,
  remindersFromType,
  remindersToInput,
  validateReminders,
  type ReminderDraft,
  type ReminderProblem,
} from '../lib/reminder-rules';
import { ChevronDownIcon } from './icons';
import { ErrorLine, TypeDot, useAppointmentsCan } from './parts';
import { ReminderRulesEditor } from './reminder-rules-editor';
import { SettingsCard } from './settings-parts';

/**
 * Reminders and follow-ups per booking type, on the Appointment settings page (BL-283). One block per booking type, each saved on its own
 * (a reminder change must not wait for, or be lost with, the page's other settings). Nothing is sent until a rule is switched on.
 */
export function ReminderRulesSection() {
  const t = useTranslations('appointments.reminders');
  const can = useAppointmentsCan();
  const types = useBookingTypes();

  return (
    <SettingsCard id="reminders" title={t('settingsTitle')} description={t('settingsDescription')}>
      {types.isPending ? (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : types.isError ? (
        <ErrorLine error={types.error} onRetry={() => void types.refetch()} />
      ) : types.data.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          {t('noTypes')}
        </p>
      ) : (
        <ul className="space-y-3">
          {types.data.map((type) => (
            <li key={type.id}>
              <TypeReminders type={type} canEdit={can.manageTypes} />
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

function TypeReminders({ type, canEdit }: { type: BookingType; canEdit: boolean }) {
  const t = useTranslations('appointments.reminders');
  const { toast } = useToast();
  const qc = useQueryClient();
  const templates = useWaTemplates();
  const channelStates = useAppointmentChannels().data;
  const library = useMessageLibrary().data;

  const saved = useMemo(() => remindersFromType(type.reminders), [type.reminders]);
  const [rules, setRules] = useState<ReminderDraft[]>(saved);
  const [seen, setSeen] = useState(type.rowVersion);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);

  const dirty = remindersChanged(saved, rules);
  // A newer copy of the type arrives (another tab saved, a refetch): take it when nothing here is being edited.
  if (!dirty && type.rowVersion !== seen) {
    setSeen(type.rowVersion);
    setRules(saved);
  }

  const problems = useMemo(() => validateReminders(rules), [rules]);
  const problemCount = Object.keys(problems).length;
  const errorOf = (key: string): string | undefined => {
    const p: ReminderProblem | undefined = tried ? problems[key] : undefined;
    return p
      ? t(`problems.${p}`, {
          max: REMINDER_MAX_RULES,
          min: UNDELIVERED_MIN,
          maxMinutes: UNDELIVERED_MAX,
        })
      : undefined;
  };
  const on = rules.filter((r) => r.enabled).length;
  const disabled = !canEdit || saving;

  async function save() {
    if (saving || !canEdit) return;
    setTried(true);
    setError(null);
    setConflict(false);
    if (problemCount > 0) {
      toast(t('fixFirst'), 'danger');
      return;
    }
    setSaving(true);
    try {
      const next = await appointmentsApi.updateTypeReminders(type, remindersToInput(rules));
      qc.setQueryData<BookingType[]>(KEYS.types, (cur) =>
        cur?.map((x) => (x.id === next.id ? next : x)),
      );
      qc.setQueryData(KEYS.type(next.id), next);
      setSeen(next.rowVersion);
      setRules(remindersFromType(next.reminders));
      setTried(false);
      toast(t('saved', { name: type.name }));
    } catch (e) {
      if (errorKind(e) === 'conflict') setConflict(true);
      else setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function reload() {
    await qc.invalidateQueries({ queryKey: KEYS.types });
    setRules(saved);
    setSeen(undefined);
    setConflict(false);
  }

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <TypeDot color={type.color} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{type.name}</span>
        {!type.isActive && <span className="text-xs text-muted-foreground">{t('paused')}</span>}
        <span className="text-xs text-muted-foreground">
          {rules.length === 0 ? t('summaryNone') : t('summary', { on, total: rules.length })}
          {dirty ? ` · ${t('unsaved')}` : ''}
        </span>
        <ChevronDownIcon className={open ? 'rotate-180' : undefined} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-3">
          {conflict && (
            <Alert
              tone="danger"
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <span>{t('conflict')}</span>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => void reload()}
              >
                {t('reload')}
              </Button>
            </Alert>
          )}
          {error !== null && !conflict && <ErrorLine error={error} />}
          <ReminderRulesEditor
            rules={rules}
            onChange={setRules}
            disabled={disabled}
            errorOf={errorOf}
            typeName={type.name}
            templates={templates.data ?? []}
            channelStates={channelStates}
            library={library}
            idPrefix={`rem-${type.id}`}
          />
          {canEdit ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!dirty || saving}
                onClick={() => {
                  setRules(saved);
                  setTried(false);
                  setError(null);
                }}
              >
                {t('discard')}
              </Button>
              <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
                {saving ? t('saving') : t('save')}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('readOnly')}</p>
          )}
        </div>
      )}
    </div>
  );
}
