'use client';

import { useTranslations } from 'next-intl';
import { Button, Menu, MenuItem, MenuLabel, MenuSeparator, Spinner } from '@crm/ui';
import type { Member } from '../api/schemas';
import { useTaskOutcomes } from '../api/hooks';
import { useActivitySettings } from '@/features/sales-activities';
import { clampOutcomeLabel } from '../lib/outcomes';
import { CheckIcon, TrashIcon, UsersIcon } from './icons';

export interface BulkBarProps {
  count: number;
  busy: boolean;
  members: readonly Member[];
  meId: string;
  canUpdate: boolean;
  canDelete: boolean;
  /** On the Completed tab the bar re-opens instead of completing. */
  completed: boolean;
  /** Completes (on the Completed tab: re-opens) the selection; with an outcome id it records that outcome too. */
  onComplete: (outcomeId?: string) => void;
  onAssign: (assigneeId: string | null) => void;
  onDelete: () => void;
  onClear: () => void;
}

/** Appears over the table while rows are ticked: complete, assign to someone, delete. */
export function BulkBar(p: BulkBarProps) {
  const t = useTranslations('tasks.bulk');
  const outcomes = useTaskOutcomes(true);
  const settings = useActivitySettings('task');
  const outcomeList = outcomes.data ?? [];
  const canPickOutcome = outcomeList.length > 0 && !(settings.loaded && !settings.outcomesEnabled);
  const label = p.completed ? t('reopen') : t('complete');
  const withLabel = p.completed ? t('reopenWithOutcome') : t('completeWithOutcome');
  return (
    <div
      role="region"
      aria-label={t('label')}
      className="flex flex-wrap items-center gap-2 rounded-md border border-brand/30 bg-brand/5 px-3 py-2 text-sm"
    >
      <span className="font-medium" aria-live="polite">
        {t('selected', { count: p.count })}
      </span>
      {p.busy && <Spinner label={t('working')} />}
      {p.canUpdate && (
        <>
          <Button size="sm" variant="secondary" disabled={p.busy} onClick={() => p.onComplete()}>
            <CheckIcon /> {label}
          </Button>
          {canPickOutcome && (
            <Menu
              label={withLabel}
              disabled={p.busy}
              triggerClassName="h-8 px-3"
              trigger={<>{withLabel}</>}
            >
              <MenuLabel>{t('pickOutcome')}</MenuLabel>
              {outcomeList.map((o) => (
                <MenuItem key={o.id} onSelect={() => p.onComplete(o.id)}>
                  <span title={o.name}>{clampOutcomeLabel(o.name)}</span>
                </MenuItem>
              ))}
            </Menu>
          )}
          <Menu
            label={t('assign')}
            disabled={p.busy}
            triggerClassName="h-8 px-3"
            trigger={
              <>
                <UsersIcon /> {t('assign')}
              </>
            }
          >
            <MenuLabel>{t('assignTo')}</MenuLabel>
            {p.members.map((m) => (
              <MenuItem key={m.id} onSelect={() => p.onAssign(m.id)}>
                {m.id === p.meId ? t('me', { name: m.fullName }) : m.fullName}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem onSelect={() => p.onAssign(null)}>{t('unassign')}</MenuItem>
          </Menu>
        </>
      )}
      {p.canDelete && (
        <Button
          size="sm"
          variant="secondary"
          className="border-danger text-danger hover:bg-danger/10"
          disabled={p.busy}
          onClick={p.onDelete}
        >
          <TrashIcon /> {t('delete')}
        </Button>
      )}
      <button
        type="button"
        onClick={p.onClear}
        className="ms-auto text-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t('clear')}
      </button>
    </div>
  );
}
