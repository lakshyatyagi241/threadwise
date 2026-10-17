'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Popover, cn } from '@crm/ui';
import { CONVERSATION_PRIORITIES, type ConversationPriority } from '@crm/contracts';
import { SNOOZE_PRESETS, type SnoozePreset } from '../lib/selection';
import { ClockIcon, FlagIcon } from './icons';

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

const FLAG_TONE: Record<ConversationPriority, string> = {
  low: 'text-success',
  normal: 'text-primary',
  high: 'text-warning',
  urgent: 'text-danger',
};

/** An icon button that opens a small list under it (closes on a pick, Escape or a press outside). */
function IconMenu(props: {
  testId: string;
  label: string;
  icon: ReactNode;
  disabled: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        data-testid={props.testId}
        title={props.label}
        aria-label={props.label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={props.disabled}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        className="grid size-8 place-items-center rounded-md border border-border bg-background hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      >
        {props.icon}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={props.label}
        className="w-48 space-y-0.5 p-1"
      >
        {props.children(() => setOpen(false))}
      </Popover>
    </div>
  );
}

const itemClass =
  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';

/**
 * Priority and snooze of the open conversation, two icon buttons in the thread header (a flag and a clock), each opening its list.
 * Each shows only to a caller who holds the right.
 */
export function TriageMenu(props: TriageMenuProps) {
  const t = useTranslations('team-inbox-conversations.triage');
  const tp = useTranslations('team-inbox-conversations.list');
  const tb = useTranslations('team-inbox-conversations.bulk');
  return (
    <>
      {props.canPriority && (
        <IconMenu
          testId="inbox-priority"
          label={`${t('priority')}: ${tp(`priority.${props.priority}`)}`}
          disabled={props.busy}
          icon={<FlagIcon className={cn('size-4', FLAG_TONE[props.priority])} />}
        >
          {(close) =>
            CONVERSATION_PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                role="menuitemradio"
                aria-checked={props.priority === p}
                data-testid={`inbox-priority-${p}`}
                onClick={() => {
                  close();
                  props.onPriority(p);
                }}
                className={cn(itemClass, props.priority === p && 'font-semibold')}
              >
                <FlagIcon className={cn('size-4', FLAG_TONE[p])} />
                <span className="flex-1">{tp(`priority.${p}`)}</span>
                {props.priority === p && <span aria-hidden="true">✓</span>}
              </button>
            ))
          }
        </IconMenu>
      )}
      {props.canSnooze && !props.snoozed && (
        <IconMenu
          testId="inbox-snooze"
          label={t('snooze')}
          disabled={props.busy}
          icon={<ClockIcon className="size-4" />}
        >
          {(close) =>
            SNOOZE_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                role="menuitem"
                data-testid={`inbox-snooze-${p}`}
                onClick={() => {
                  close();
                  props.onSnooze(p);
                }}
                className={itemClass}
              >
                <ClockIcon className="size-4 text-muted-foreground" />
                <span>{tb(`snoozePreset.${p}`)}</span>
              </button>
            ))
          }
        </IconMenu>
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
