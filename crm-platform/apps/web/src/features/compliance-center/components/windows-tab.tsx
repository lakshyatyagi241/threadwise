'use client';

import { useTranslations } from 'next-intl';
import { DND_REGISTRIES, effectivePolicy } from '@crm/contracts';
import { Alert, Checkbox, Field, Input, Select, Switch } from '@crm/ui';
import { timezoneList } from '@/lib/timezones';
import { problemFor, toggleDay, type Problem, type SettingsForm } from '../lib/model';
import { CARD } from './fields';

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Quiet hours for messages, a calling window for calls, the fallback time zone they are read in and the Do Not Call / DND registry the
 * workspace scrubs against. Enforced (BL-177): a marketing message inside the quiet hours is held until they end, a call outside the
 * calling window is refused. Each is read on the contact's own clock; the zone here is the fallback. The screen says what is and is not
 * held, and so does the checklist.
 */
export function WindowsTab({
  form,
  patch,
  problems,
  canManage,
  workspaceTimezone,
}: {
  form: SettingsForm;
  patch: (p: Partial<SettingsForm>) => void;
  problems: Problem[];
  canManage: boolean;
  workspaceTimezone: string | null;
}) {
  const t = useTranslations('compliance-center.windows');
  const tp = useTranslations('compliance-center.problems');
  const effective = effectivePolicy(form.regimes);
  const quietProblem = problemFor(problems, 'quietHours.end');
  const windowProblem = problemFor(problems, 'callingWindow.end');
  const daysProblem = problemFor(problems, 'callingWindow.days');
  const zones = timezoneList(form.windowTimezone || undefined);

  return (
    <div className="space-y-4">
      <Alert tone="info" data-testid="enforced-note">
        {t('enforcedNote')}
      </Alert>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      <section className={CARD} data-testid="quiet-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{t('quiet.title')}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('quiet.hint')}</p>
          </div>
          <Switch
            id="quiet-enabled"
            checked={form.quietHours.enabled}
            onCheckedChange={(v) => patch({ quietHours: { ...form.quietHours, enabled: v } })}
            label={t('quiet.enabled')}
            disabled={!canManage}
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t('quiet.start')} htmlFor="quiet-start">
            <Input
              id="quiet-start"
              type="time"
              value={form.quietHours.start}
              disabled={!canManage}
              onChange={(e) => patch({ quietHours: { ...form.quietHours, start: e.target.value } })}
            />
          </Field>
          <Field
            label={t('quiet.end')}
            htmlFor="quiet-end"
            error={quietProblem ? tp(quietProblem) : undefined}
          >
            <Input
              id="quiet-end"
              type="time"
              value={form.quietHours.end}
              disabled={!canManage}
              invalid={quietProblem !== undefined}
              onChange={(e) => patch({ quietHours: { ...form.quietHours, end: e.target.value } })}
            />
          </Field>
        </div>
        {effective.quietHours && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t('suggested', { start: effective.quietHours.start, end: effective.quietHours.end })}
          </p>
        )}
      </section>

      <section className={CARD} data-testid="calling-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{t('calling.title')}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('calling.hint')}</p>
          </div>
          <Switch
            id="calling-enabled"
            checked={form.callingWindow.enabled}
            onCheckedChange={(v) => patch({ callingWindow: { ...form.callingWindow, enabled: v } })}
            label={t('calling.enabled')}
            disabled={!canManage}
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t('calling.start')} htmlFor="calling-start">
            <Input
              id="calling-start"
              type="time"
              value={form.callingWindow.start}
              disabled={!canManage}
              onChange={(e) =>
                patch({ callingWindow: { ...form.callingWindow, start: e.target.value } })
              }
            />
          </Field>
          <Field
            label={t('calling.end')}
            htmlFor="calling-end"
            error={windowProblem ? tp(windowProblem) : undefined}
          >
            <Input
              id="calling-end"
              type="time"
              value={form.callingWindow.end}
              disabled={!canManage}
              invalid={windowProblem !== undefined}
              onChange={(e) =>
                patch({ callingWindow: { ...form.callingWindow, end: e.target.value } })
              }
            />
          </Field>
        </div>
        <fieldset className="mt-3" disabled={!canManage}>
          <legend className="mb-1 text-sm font-medium">{t('calling.days')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {DAYS.map((d) => (
              <Checkbox
                key={d}
                id={`day-${d}`}
                checked={form.callingWindow.days.includes(d)}
                label={t(`day.${d}`)}
                onChange={() =>
                  patch({
                    callingWindow: {
                      ...form.callingWindow,
                      days: toggleDay(form.callingWindow.days, d),
                    },
                  })
                }
              />
            ))}
          </div>
          {daysProblem && <p className="mt-1 text-xs text-danger">{tp(daysProblem)}</p>}
        </fieldset>
        {effective.callingWindow && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t('suggested', {
              start: effective.callingWindow.start,
              end: effective.callingWindow.end,
            })}
          </p>
        )}
      </section>

      <section className={CARD}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('zone.label')}
            htmlFor="window-zone"
            hint={t('zone.hint', { zone: workspaceTimezone ?? 'UTC' })}
          >
            <Select
              id="window-zone"
              value={form.windowTimezone}
              disabled={!canManage}
              onChange={(e) => patch({ windowTimezone: e.target.value })}
            >
              <option value="">{t('zone.workspace', { zone: workspaceTimezone ?? 'UTC' })}</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('dnd.label')} htmlFor="dnd" hint={t('dnd.hint')}>
            <Select
              id="dnd"
              value={form.dndRegistry}
              disabled={!canManage}
              onChange={(e) =>
                patch({ dndRegistry: e.target.value as SettingsForm['dndRegistry'] })
              }
            >
              {DND_REGISTRIES.map((r) => (
                <option key={r} value={r}>
                  {t(`dnd.registry.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t('dnd.note')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('dnd.listNote')}</p>
      </section>
    </div>
  );
}
