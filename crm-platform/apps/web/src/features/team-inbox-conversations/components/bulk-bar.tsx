'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { Button, Select, Spinner } from '@crm/ui';
import {
  CONVERSATION_PRIORITIES,
  type BulkConversationAction,
  type ConversationPriority,
} from '@crm/contracts';
import { useAssignees, useTags } from '../api/hooks';
import { leaveDayText } from '../lib/leave-mark';
import { SNOOZE_PRESETS, snoozeUntil, type SnoozePreset } from '../lib/selection';

export interface BulkBarProps {
  /** How many conversations are selected, and how many the list shows. */
  count: number;
  inView: number;
  allInViewSelected: boolean;
  busy: boolean;
  can: {
    resolve: boolean;
    assign: boolean;
    assignSelf: boolean;
    priority: boolean;
    snooze: boolean;
    tag: boolean;
  };
  meId: string;
  onSelectAll: () => void;
  onClear: () => void;
  onRun: (action: BulkConversationAction) => void;
}

/**
 * The bar that replaces the list's filters while conversations are selected: "N selected", select all in view, clear, and the actions
 * the caller may use (mark read, resolve, close, reopen, assign, priority, snooze). It only offers what the caller holds; the server
 * checks every conversation again and answers each one's outcome.
 */
export function BulkBar(props: BulkBarProps) {
  const t = useTranslations('team-inbox-conversations.bulk');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const tp = useTranslations('team-inbox-conversations.list');
  const { can } = props;
  const assignees = useAssignees(can.assign || can.assignSelf);
  const tags = useTags(can.tag);
  const disabled = props.busy || props.count === 0;

  const pick = (value: string, run: (value: string) => void) => {
    if (value) run(value);
  };

  return (
    <div
      className="space-y-2 border-b border-border bg-muted/40 px-3 py-2"
      data-testid="inbox-bulk-bar"
      role="region"
      aria-label={t('barLabel')}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm font-medium" role="status" data-testid="inbox-bulk-count">
          {t('selected', { count: props.count })}
        </p>
        <button
          type="button"
          onClick={props.onSelectAll}
          disabled={props.allInViewSelected || props.busy}
          data-testid="inbox-bulk-all"
          className="text-xs text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary disabled:text-muted-foreground disabled:no-underline"
        >
          {t('selectAllInView', { count: props.inView })}
        </button>
        <button
          type="button"
          onClick={props.onClear}
          data-testid="inbox-bulk-clear"
          className="ms-auto text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('done')}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          data-testid="inbox-bulk-read"
          onClick={() => props.onRun({ type: 'mark_read' })}
        >
          {t('markRead')}
        </Button>
        {can.resolve && (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled}
              data-testid="inbox-bulk-resolve"
              onClick={() => props.onRun({ type: 'status', status: 'resolved' })}
            >
              {t('resolve')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled}
              data-testid="inbox-bulk-close"
              onClick={() => props.onRun({ type: 'status', status: 'closed' })}
            >
              {t('close')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled}
              data-testid="inbox-bulk-reopen"
              onClick={() => props.onRun({ type: 'status', status: 'open' })}
            >
              {t('reopen')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled}
              data-testid="inbox-bulk-spam"
              onClick={() => props.onRun({ type: 'spam' })}
            >
              {t('spam')}
            </Button>
          </>
        )}
        {(can.assign || can.assignSelf) && (
          <Select
            aria-label={t('assign')}
            data-testid="inbox-bulk-assign"
            value=""
            disabled={disabled}
            className="h-8 w-auto text-xs"
            onChange={(e) =>
              pick(e.target.value, (v) => {
                if (v === 'me') props.onRun({ type: 'assign', userId: props.meId });
                else if (v === 'none') props.onRun({ type: 'assign', userId: null });
                else if (v === 'no-team') props.onRun({ type: 'assign', teamId: null });
                else if (v.startsWith('u:')) props.onRun({ type: 'assign', userId: v.slice(2) });
                else if (v.startsWith('t:')) props.onRun({ type: 'assign', teamId: v.slice(2) });
              })
            }
          >
            <option value="">{t('assign')}</option>
            <option value="me">{t('assignToMe')}</option>
            {can.assign && <option value="none">{t('unassign')}</option>}
            {can.assign && <option value="no-team">{t('removeTeam')}</option>}
            {can.assign &&
              assignees.data?.users
                .filter((u) => !u.isMe)
                .map((u) => (
                  <option key={u.id} value={`u:${u.id}`}>
                    {u.name ?? u.email}
                    {u.onLeave
                      ? ` · ${u.onLeave.until ? t('onLeaveUntil', { date: leaveDayText(u.onLeave.until, locale) }) : t('onLeave')}`
                      : ''}
                  </option>
                ))}
            {can.assign &&
              assignees.data?.teams.map((team) => (
                <option key={team.id} value={`t:${team.id}`}>
                  {team.name}
                </option>
              ))}
          </Select>
        )}
        {can.priority && (
          <Select
            aria-label={t('priority')}
            data-testid="inbox-bulk-priority"
            value=""
            disabled={disabled}
            className="h-8 w-auto text-xs"
            onChange={(e) =>
              pick(e.target.value, (v) =>
                props.onRun({ type: 'priority', priority: v as ConversationPriority }),
              )
            }
          >
            <option value="">{t('priority')}</option>
            {CONVERSATION_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {tp(`priority.${p}`)}
              </option>
            ))}
          </Select>
        )}
        {can.snooze && (
          <Select
            aria-label={t('snooze')}
            data-testid="inbox-bulk-snooze"
            value=""
            disabled={disabled}
            className="h-8 w-auto text-xs"
            onChange={(e) =>
              pick(e.target.value, (v) =>
                props.onRun({
                  type: 'snooze',
                  until: snoozeUntil(v as SnoozePreset, new Date(), timeZone),
                }),
              )
            }
          >
            <option value="">{t('snooze')}</option>
            {SNOOZE_PRESETS.map((p) => (
              <option key={p} value={p}>
                {t(`snoozePreset.${p}`)}
              </option>
            ))}
          </Select>
        )}
        {can.tag && (tags.data?.data.length ?? 0) > 0 && (
          <Select
            aria-label={t('tag')}
            data-testid="inbox-bulk-tag"
            value=""
            disabled={disabled}
            className="h-8 w-auto text-xs"
            onChange={(e) =>
              pick(e.target.value, (v) => {
                const [mode, tagId] = v.split(':') as ['add' | 'remove', string];
                props.onRun({ type: 'tag', mode, tagId: tagId! });
              })
            }
          >
            <option value="">{t('tag')}</option>
            <optgroup label={t('tagAdd')}>
              {tags.data?.data.map((l) => (
                <option key={`a${l.id}`} value={`add:${l.id}`}>
                  {l.name}
                </option>
              ))}
            </optgroup>
            <optgroup label={t('tagRemove')}>
              {tags.data?.data.map((l) => (
                <option key={`r${l.id}`} value={`remove:${l.id}`}>
                  {l.name}
                </option>
              ))}
            </optgroup>
          </Select>
        )}
        {props.busy && <Spinner />}
      </div>
    </div>
  );
}
