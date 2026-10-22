'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, ConfirmDialog, Drawer, Field, Input, Switch, useToast } from '@crm/ui';
import {
  ACTIVITY_NAME_MAX,
  ERROR_CODES,
  activityCapabilities,
  type ActivityOption,
  type SalesActivityType,
  type PhoneCountsAs,
  type UpdateActivityTypeInput,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { activityTypesApi, useActivityMutation } from '../api/activity-types';
import { useActivityLabels } from '../lib/labels';
import { OptionList } from './option-list';
import { TaskOutcomesList } from './task-outcomes-list';

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3">
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} label={label} />
      <span className="text-sm">
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * "Edit activity": the activity's switches and its lists. Everything saves as it is changed (a switch, a name when you leave it, an item
 * added, removed or moved), so there is nothing to forget to save. A default activity keeps its name; its switches and lists change.
 */
export function ActivityDrawer({
  activity,
  canManage,
  onClose,
  onRemoved,
}: {
  activity: SalesActivityType;
  canManage: boolean;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const t = useTranslations('sales-activities.drawer');
  // the outcomes screen needs its own key: no link to a screen the person cannot use
  const canOutcomes = useCan('settings.task_outcomes.manage');
  // The default Task activity's outcomes are the workspace's task outcomes (their own routes and permission); every other list is the registry's.
  const isTaskActivity = activity.key === 'task' && activity.isDefault;
  const { toast } = useToast();
  const labels = useActivityLabels();
  const cap = activityCapabilities(activity.behavesAs);
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const errorText = (e: unknown): string => {
    if (e instanceof ApiError) {
      if (e.code === ERROR_CODES.ACTIVITY_NAME_TAKEN) return t('errors.nameTaken');
      if (e.code === ERROR_CODES.ACTIVITY_LIMIT_REACHED) return t('errors.limit');
      if (e.code === ERROR_CODES.ROW_VERSION_CONFLICT) return t('errors.conflict');
      if (e.code === ERROR_CODES.FORBIDDEN) return t('errors.forbidden');
    }
    return t('errors.failed');
  };

  const update = useActivityMutation((v: UpdateActivityTypeInput) =>
    activityTypesApi.update(activity.id, v),
  );
  const add = useActivityMutation(
    (v: { kind: 'type' | 'outcome'; name: string; countsAs?: PhoneCountsAs }) =>
      activityTypesApi.addOption(activity.id, v),
  );
  const removeOption = useActivityMutation((o: ActivityOption) =>
    activityTypesApi.removeOption(activity.id, o.id),
  );
  const reorder = useActivityMutation((v: { kind: 'type' | 'outcome'; ids: string[] }) =>
    activityTypesApi.reorder(activity.id, v),
  );
  const removeActivity = useActivityMutation(() => activityTypesApi.remove(activity.id));
  const busy =
    update.isPending ||
    add.isPending ||
    removeOption.isPending ||
    reorder.isPending ||
    removeActivity.isPending;
  const locked = !canManage;

  const setSwitch = (patch: Omit<UpdateActivityTypeInput, 'rowVersion'>) =>
    update.mutate(
      { ...patch, rowVersion: activity.rowVersion },
      { onSuccess: () => toast(t('saved')), onError: (e) => toast(errorText(e), 'danger') },
    );

  const saveName = (value: string) => {
    const v = value.trim();
    if (activity.isDefault || v === (activity.name ?? '')) return setNameError(null);
    if (!v) return setNameError(t('errors.nameRequired'));
    setNameError(null);
    update.mutate(
      { name: v, rowVersion: activity.rowVersion },
      {
        onSuccess: () => toast(t('saved')),
        onError: (e) => setNameError(errorText(e)),
      },
    );
  };

  const addOption = (kind: 'type' | 'outcome') => (name: string, countsAs?: PhoneCountsAs) =>
    add.mutateAsync({ kind, name, countsAs }).then(
      () => true,
      (e: unknown) => {
        toast(errorText(e), 'danger');
        return false;
      },
    );

  const nameOf = (o: ActivityOption) => labels.option(activity.key, o);
  const title = labels.activity(activity);

  return (
    <Drawer
      open
      onClose={onClose}
      closeLabel={t('close')}
      title={t('title', { name: title })}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {!activity.isDefault && canManage ? (
            <Button variant="ghost" onClick={() => setConfirmRemove(true)} disabled={busy}>
              {t('removeActivity')}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="brand" onClick={onClose}>
            {t('done')}
          </Button>
        </div>
      }
    >
      <div className="space-y-6 p-5">
        {!locked && <p className="text-xs text-muted-foreground">{t('autosave')}</p>}
        {locked && <Alert tone="info">{t('readOnly')}</Alert>}

        <Field
          label={t('name')}
          htmlFor="activity-name"
          error={nameError ?? undefined}
          hint={activity.isDefault ? t('nameLocked') : undefined}
        >
          <Input
            key={`${activity.id}:${activity.rowVersion}`}
            id="activity-name"
            defaultValue={title}
            maxLength={ACTIVITY_NAME_MAX}
            readOnly={activity.isDefault || locked}
            invalid={!!nameError}
            dir="auto"
            onBlur={(e) => saveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </Field>

        <div className="space-y-4">
          {cap.mobileCheckIn && (
            <>
              <Toggle
                label={t('mobileCheckIn')}
                checked={activity.mobileCheckIn}
                disabled={locked || busy}
                onChange={(v) => setSwitch({ mobileCheckIn: v })}
              />
              {activity.mobileCheckIn && <Alert tone="info">{t('mobileCheckInPending')}</Alert>}
            </>
          )}
          {cap.showInCalendar && (
            <Toggle
              label={t('showInCalendar')}
              hint={t('showInCalendarHint')}
              checked={activity.showInCalendar}
              disabled={locked || busy}
              onChange={(v) => setSwitch({ showInCalendar: v })}
            />
          )}
          {cap.allowComplete && (
            <Toggle
              label={t('allowComplete')}
              checked={activity.allowComplete}
              disabled={locked || busy}
              onChange={(v) => setSwitch({ allowComplete: v })}
            />
          )}
          {cap.allowEditCompleted && (
            <Toggle
              label={t('allowEditCompleted')}
              checked={activity.allowEditCompleted}
              disabled={locked || busy || !activity.allowComplete}
              onChange={(v) => setSwitch({ allowEditCompleted: v })}
            />
          )}
        </div>

        {cap.taskTypes && (
          <OptionList
            title={t('taskTypes')}
            hint={t('taskTypesHint')}
            items={activity.taskTypes}
            nameOf={nameOf}
            disabled={locked}
            busy={busy}
            addLabel={t('addTaskType')}
            placeholder={t('taskTypePlaceholder')}
            onAdd={addOption('type')}
            onRemove={(o) =>
              removeOption.mutate(o, { onError: (e) => toast(errorText(e), 'danger') })
            }
            onReorder={(ids) =>
              reorder.mutate(
                { kind: 'type', ids },
                { onError: (e) => toast(errorText(e), 'danger') },
              )
            }
          />
        )}

        {cap.outcomes && (
          <div className="space-y-3">
            {activity.behavesAs !== 'phone' && (
              <Toggle
                label={t('predictOutcomes')}
                hint={t('predictOutcomesHint')}
                checked={activity.outcomesEnabled}
                disabled={locked || busy}
                onChange={(v) => setSwitch({ outcomesEnabled: v })}
              />
            )}
            {activity.outcomesEnabled && isTaskActivity && (
              <TaskOutcomesList canManage={canOutcomes} />
            )}
            {activity.outcomesEnabled && !isTaskActivity && (
              <OptionList
                title={t('outcomes')}
                hint={activity.behavesAs === 'phone' ? t('phoneOutcomesHint') : t('outcomesHint')}
                items={activity.outcomes}
                nameOf={nameOf}
                disabled={locked}
                busy={busy}
                withCountsAs={activity.behavesAs === 'phone'}
                addLabel={t('addOutcome')}
                placeholder={t('outcomePlaceholder')}
                onAdd={addOption('outcome')}
                onRemove={(o) =>
                  removeOption.mutate(o, { onError: (e) => toast(errorText(e), 'danger') })
                }
                onReorder={(ids) =>
                  reorder.mutate(
                    { kind: 'outcome', ids },
                    { onError: (e) => toast(errorText(e), 'danger') },
                  )
                }
              />
            )}
          </div>
        )}

        {!cap.outcomes && !cap.taskTypes && !cap.showInCalendar && (
          <p className="text-sm text-muted-foreground">{t('noSettings')}</p>
        )}
      </div>
      <ConfirmDialog
        open={confirmRemove}
        title={t('removeConfirmTitle', { name: title })}
        message={t('removeConfirmBody')}
        confirmLabel={t('removeActivity')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={removeActivity.isPending}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() =>
          removeActivity.mutate(undefined, {
            onSuccess: () => {
              setConfirmRemove(false);
              toast(t('removed'));
              onRemoved();
            },
            onError: (e) => {
              setConfirmRemove(false);
              toast(errorText(e), 'danger');
            },
          })
        }
      />
    </Drawer>
  );
}
