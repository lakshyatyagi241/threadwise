'use client';

import { useTranslations } from 'next-intl';
import { Select } from '@crm/ui';
import { CONVERSATION_PRIORITIES, type ConversationPriority } from '@crm/contracts';
import { SNOOZE_PRESETS, type SnoozePreset } from '../lib/selection';

export interface TriageMenuProps {
  priority: ConversationPriority;
  snoozed: boolean;
  canPriority: boolean;
  canSnooze: boolean;
  /** A wake-up needs the right to change the status (resolve), the same route as reopening. */
  canWake: boolean;
  busy: boolean;
  onPriority: (priority: ConversationPriority) => void;
  onSnooze: (preset: SnoozePreset) => void;
  onWake: () => void;
}

/** Priority and snooze of the open conversation, two compact selects in the thread header. Each shows only to a caller who holds the right. */
export function TriageMenu(props: TriageMenuProps) {
  const t = useTranslations('team-inbox-conversations.triage');
  const tp = useTranslations('team-inbox-conversations.list');
  const tb = useTranslations('team-inbox-conversations.bulk');
  return (
    <>
      {props.canPriority && (
        <Select
          aria-label={t('priority')}
          data-testid="inbox-priority"
          value={props.priority}
          disabled={props.busy}
          className="h-8 w-auto text-xs"
          onChange={(e) => props.onPriority(e.target.value as ConversationPriority)}
        >
          {CONVERSATION_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {tp(`priority.${p}`)}
            </option>
          ))}
        </Select>
      )}
      {props.canSnooze && !props.snoozed && (
        <Select
          aria-label={t('snooze')}
          data-testid="inbox-snooze"
          value=""
          disabled={props.busy}
          className="h-8 w-auto text-xs"
          onChange={(e) => e.target.value && props.onSnooze(e.target.value as SnoozePreset)}
        >
          <option value="">{t('snooze')}</option>
          {SNOOZE_PRESETS.map((p) => (
            <option key={p} value={p}>
              {tb(`snoozePreset.${p}`)}
            </option>
          ))}
        </Select>
      )}
      {props.snoozed && props.canWake && (
        <button
          type="button"
          data-testid="inbox-wake"
          disabled={props.busy}
          onClick={props.onWake}
          className="h-8 rounded-md border border-border px-2 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          {t('wake')}
        </button>
      )}
    </>
  );
}
