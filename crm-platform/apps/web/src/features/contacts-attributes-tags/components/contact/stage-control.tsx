'use client';

import { useTranslations } from 'next-intl';
import { Select, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import type { ContactRow } from '../../api/schemas';
import { StagePicker } from '../stage-picker';
import { useStageChange } from './use-stage-change';

/**
 * The record page's lifecycle control: "Stage: Qualified" (the shared `StagePicker`, with "3 of 9" beside it) and the small Status
 * menu next to it; a thin line of segments under them shows how far along the contact is and cannot scroll sideways however many stages
 * there are.
 */
export function StageControl({ contact, className }: { contact: ContactRow; className?: string }) {
  const t = useTranslations('contacts-attributes-tags.contact.record.stagePicker');
  const ts = useTranslations('contacts-attributes-tags.contact.stages');
  const tr = useTranslations('contacts-attributes-tags.contact.record.stageStrip');
  const canUpdate = useCan('record.contacts.update');
  const stage = useStageChange(contact);
  const current = contact.lifecycleStage;
  const at = stage.stages.findIndex((s) => s.value === current);
  if (stage.stages.length === 0) return null;
  const label = stage.stages[at]?.label ?? current ?? '';

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center gap-2">
        <StagePicker
          look="field"
          className="min-w-0 flex-1"
          value={current ?? ''}
          status={contact.status}
          stages={stage.stages}
          statusesOf={stage.statusesOf}
          defaultStatusOf={stage.defaultStatusOf}
          hint={stage.hint}
          readOnly={!canUpdate}
          busy={stage.busy}
          name={contact.name ?? undefined}
          prefix={t('prefix')}
          triggerText={label}
          onPick={(s, status) => stage.changeStage(s, status)}
        />
        {stage.statuses.length > 0 && (
          <Select
            aria-label={ts('status')}
            value={contact.status ?? ''}
            disabled={!canUpdate || stage.busy}
            onChange={(e) => stage.changeStatus(e.target.value)}
            className="h-8 w-auto min-w-0 max-w-[7.5rem] shrink-0 px-2 py-0 text-xs"
          >
            {contact.status === null || contact.status === '' ? (
              <option value="" disabled>
                {tr('noStatus')}
              </option>
            ) : null}
            {stage.statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        )}
      </div>
      {at >= 0 && stage.stages.length > 1 && (
        <div
          role="img"
          aria-label={t('progress', { current: at + 1, total: stage.stages.length })}
          title={t('progress', { current: at + 1, total: stage.stages.length })}
          className="flex items-center gap-1 px-0.5"
        >
          {stage.stages.map((s, i) => (
            <span
              key={s.value}
              className={cn(
                'h-1 min-w-0 flex-1 rounded-full',
                i < at ? 'bg-brand/40' : i === at ? 'bg-brand' : 'bg-border',
              )}
            />
          ))}
        </div>
      )}
      {stage.dialog}
    </div>
  );
}
