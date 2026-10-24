'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  BUSINESS_HOURS_DAY_KEYS,
  type BusinessHoursDay,
  type MemberWorkingHours,
} from '@crm/contracts';
import { Alert, Button, Checkbox, Field, Input, Modal, Spinner, Switch, useToast } from '@crm/ui';
import { TimezoneCombobox } from '@/features/auth-registration-security/shared/timezone-combobox';
import {
  MAX_WINDOWS,
  addWindow,
  checkDraft,
  copyMondayToWeekdays,
  draftFrom,
  hasProblems,
  isAllDay,
  isOvernight,
  removeWindow,
  setAllDay,
  toRequest,
  type DayDraft,
  type Problems,
  type WorkingHoursDraft,
} from '@/features/admin-console-shell/workspace-settings/working-hours';
import { AddonLockLink } from '@/features/plans-subscriptions-trials/components/addon-lock';
import { ApiError } from '@/lib/api/errors';
import { useSaveWorkingHours, useWorkingHours } from '../api/hooks';

const HOURS = 'admin-console-shell.workspaceSettings.general.hours';

/** Whether any day of the draft is open (an empty week makes the person always Available). */
export const hasOpenDay = (draft: WorkingHoursDraft): boolean =>
  BUSINESS_HOURS_DAY_KEYS.some((k) => draft.days[k].enabled);

/**
 * Personal working hours (docs/specs/agent-status-bar.md): per-day ranges (several a day, days off), the person's time zone (prefilled
 * from the workspace) and the "Automate my status" switch. Outside the hours the person is Away by themselves. `memberId` is `me` for the
 * caller, or a member's id for a manager (Settings > Team). Reading is always allowed; saving needs the plan feature
 * `agent_status_automation` (locked state with the way to Plans) and `team.leave.manage` (the server says `canEdit`).
 */
export function WorkingHoursDialog({
  memberId,
  memberName,
  open,
  onClose,
}: {
  memberId: string;
  /** Set when a manager edits somebody else's hours. */
  memberName?: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.status.hours');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  const th = useTranslations(HOURS);
  const q = useWorkingHours(memberId, open);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={memberName ? t('titleFor', { name: memberName }) : t('title')}
      size="md"
      closeLabel={tc('close')}
    >
      {open && q.isPending && (
        <div className="flex justify-center p-10" role="status" aria-label={tc('loading')}>
          <Spinner />
        </div>
      )}
      {open && q.isError && <Alert tone="danger">{th('loadFailed')}</Alert>}
      {open && q.data && (
        <HoursForm
          // A fresh form each time the saved hours change.
          key={JSON.stringify(q.data)}
          memberId={memberId}
          data={q.data}
          other={memberName !== undefined}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function HoursForm({
  memberId,
  data,
  other,
  onClose,
}: {
  memberId: string;
  data: MemberWorkingHours;
  other: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.status.hours');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  const th = useTranslations(HOURS);
  const { toast } = useToast();
  const save = useSaveWorkingHours(memberId);
  const [automate, setAutomate] = useState(data.automate);
  const [timezone, setTimezone] = useState(data.timezone);
  const [draft, setDraft] = useState<WorkingHoursDraft>(() =>
    draftFrom({ timezone: data.timezone, canEditTimezone: true, days: data.days, holidays: [] }),
  );
  const [problems, setProblems] = useState<Problems>({ days: {}, holidays: {} });
  const editable = data.canEdit && data.entitled;
  const busy = save.isPending;
  const setDay = (k: BusinessHoursDay, day: DayDraft) =>
    setDraft((d) => ({ ...d, days: { ...d.days, [k]: day } }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editable || busy) return;
    const found = checkDraft(draft);
    setProblems(found);
    if (hasProblems(found)) return;
    try {
      await save.mutateAsync({ automate, timezone, days: toRequest(draft).days });
      toast(th('saved'), 'success');
      onClose();
    } catch (err) {
      toast(err instanceof ApiError && err.message ? err.message : th('saveFailed'), 'danger');
    }
  }

  return (
    <>
      <form
        id="agent-working-hours-form"
        className="space-y-5"
        onSubmit={(e) => void submit(e)}
        noValidate
      >
        <p className="text-sm text-muted-foreground">{other ? t('leadOther') : t('lead')}</p>

        {!data.entitled && (
          <Alert tone="warning" data-testid="working-hours-locked">
            {t('locked')} <AddonLockLink />
          </Alert>
        )}
        {data.entitled && !data.canEdit && <Alert tone="info">{t('viewOnly')}</Alert>}

        <div className="flex items-start justify-between gap-4 rounded-xl border border-border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">{t('automate')}</div>
            <p className="text-xs text-muted-foreground">{t('automateHint')}</p>
          </div>
          <Switch
            checked={automate}
            onCheckedChange={setAutomate}
            label={t('automate')}
            disabled={!editable || busy}
          />
        </div>

        {automate && !hasOpenDay(draft) && (
          <Alert tone="warning" data-testid="working-hours-empty">
            {t('emptyWarning')}
          </Alert>
        )}

        <Field
          label={t('timezone')}
          htmlFor="agent-hours-timezone"
          hint={t('timezoneHint', { zone: data.workspaceTimezone })}
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <TimezoneCombobox
                id="agent-hours-timezone"
                value={timezone}
                extra={[data.workspaceTimezone]}
                onChange={setTimezone}
                disabled={!editable || busy}
              />
            </div>
            {timezone !== data.workspaceTimezone && editable && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setTimezone(data.workspaceTimezone)}
              >
                {t('useWorkspaceZone')}
              </Button>
            )}
          </div>
        </Field>

        <fieldset className="space-y-3" disabled={!editable || busy}>
          <legend className="sr-only">{t('title')}</legend>
          {BUSINESS_HOURS_DAY_KEYS.map((k) => {
            const day = draft.days[k];
            const problem = problems.days[k];
            const dayName = th(`day.${k}`);
            const allDay = isAllDay(day);
            return (
              <div
                key={k}
                className="grid items-start gap-3 sm:grid-cols-[110px_56px_1fr]"
                data-testid={`agent-hours-${k}`}
              >
                <span className="pt-2 text-sm font-medium">{dayName}</span>
                <div className="pt-1.5">
                  <Switch
                    checked={day.enabled}
                    onCheckedChange={(on) => setDay(k, { ...day, enabled: on })}
                    label={dayName}
                  />
                </div>
                <div className="space-y-2">
                  {!day.enabled ? (
                    <p className="pt-2 text-sm text-muted-foreground">{th('closed')}</p>
                  ) : (
                    <>
                      {allDay ? (
                        <p className="pt-2 text-sm">{th('openAllDay')}</p>
                      ) : (
                        day.windows.map((w, i) => (
                          <div key={i} className="flex flex-wrap items-center gap-2">
                            <Input
                              type="time"
                              className="w-28"
                              value={w.from}
                              aria-label={`${dayName} ${th('from')}`}
                              aria-invalid={problem ? true : undefined}
                              onChange={(e) =>
                                setDay(k, {
                                  ...day,
                                  windows: day.windows.map((x, j) =>
                                    j === i ? { ...x, from: e.target.value } : x,
                                  ),
                                })
                              }
                            />
                            <span className="text-muted-foreground" aria-hidden>
                              –
                            </span>
                            <Input
                              type="time"
                              className="w-28"
                              value={w.to}
                              aria-label={`${dayName} ${th('to')}`}
                              aria-invalid={problem ? true : undefined}
                              onChange={(e) =>
                                setDay(k, {
                                  ...day,
                                  windows: day.windows.map((x, j) =>
                                    j === i ? { ...x, to: e.target.value } : x,
                                  ),
                                })
                              }
                            />
                            {isOvernight(w) && (
                              <span className="text-xs text-muted-foreground">
                                {th('overnight')}
                              </span>
                            )}
                            {day.windows.length > 1 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setDay(k, removeWindow(day, i))}
                                aria-label={th('removeWindow', { day: dayName })}
                              >
                                {th('remove')}
                              </Button>
                            )}
                          </div>
                        ))
                      )}
                      <div className="flex flex-wrap items-center gap-3">
                        <Checkbox
                          id={`agent-hours-${k}-allday`}
                          label={th('allDay')}
                          checked={allDay}
                          onChange={(e) => setDay(k, setAllDay(day, e.target.checked))}
                        />
                        {!allDay && day.windows.length < MAX_WINDOWS && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => setDay(k, addWindow(day))}
                          >
                            {th('addWindow')}
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                  {problem && (
                    <p className="text-xs text-danger" role="alert">
                      {th(`problem.${problem}`)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setDraft(copyMondayToWeekdays(draft))}
          >
            {th('copyMonday')}
          </Button>
        </fieldset>
      </form>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {editable ? tc('cancel') : tc('close')}
        </Button>
        {editable && (
          <Button type="submit" form="agent-working-hours-form" disabled={busy}>
            {busy && <Spinner />}
            {th('save')}
          </Button>
        )}
      </div>
    </>
  );
}
