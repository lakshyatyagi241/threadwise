'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { Button, Select, Spinner } from '@crm/ui';
import {
  CONVERSATION_PRIORITIES,
  type BulkConversationAction,
  type ConversationPriority,
  type ConversationSummary,
} from '@crm/contracts';
import { useAssignees, useTags } from '../api/hooks';
import { leaveDayText } from '../lib/leave-mark';
import { SNOOZE_PRESETS, pickedState, snoozeUntil, type SnoozePreset } from '../lib/selection';

export interface BulkBarProps {
  /** How many conversations are selected, and how many the list shows. */
  count: number;
  /** The picked conversations: the bar words its actions by what they already are (spam, snoozed, unread, assigned, tagged). */
  picked: ReadonlyArray<ConversationSummary>;
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
  onToggleAll: () => void;
  onClear: () => void;
  onRun: (action: BulkConversationAction) => void;
}

/**
 * The bar that replaces the list's filters while conversations are selected: "N selected", select all in view, clear, and the actions
 * the caller may use (mark read or unread, resolve, close, reopen, spam or not spam, assign, priority, snooze or unsnooze, tag). The
 * labels follow what the picked conversations already are: when every one is spam the spam action reads "Mark as not spam", and so on
 * (`pickedState`). It only offers what the caller holds; the server checks every conversation again and answers each one's outcome.
 */
export function BulkBar(props: BulkBarProps) {
  const t = useTranslations('team-inbox-conversations.bulk');
  const ta = useTranslations('team-inbox-conversations.panel.assignee');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const tp = useTranslations('team-inbox-conversations.list');
  const { can } = props;
  const assignees = useAssignees(can.assign || can.assignSelf);
  const tags = useTags(can.tag);
  const disabled = props.busy || props.count === 0;
  const state = useMemo(() => pickedState(props.picked, props.meId), [props.picked, props.meId]);
  // Every picked conversation is snoozed: "Unsnooze" takes the snooze menu's place (the status route, as the wake button does).
  const unsnoozeShown = state.allSnoozed && can.resolve;
  const tagList = tags.data?.data;
  // Memoised: each tag is checked against every picked conversation, so the lists are rebuilt only when the tags or the pick change.
  const addTags = useMemo(
    () => (tagList ?? []).filter((l) => state.canAddTag(l.id)),
    [tagList, state],
  );
  const removeTags = useMemo(
    () => (tagList ?? []).filter((l) => state.canRemoveTag(l.id)),
    [tagList, state],
  );

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
          onClick={props.onToggleAll}
          aria-pressed={props.allInViewSelected}
          disabled={props.busy}
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
        {state.allRead ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            data-testid="inbox-bulk-unread"
            onClick={() => props.onRun({ type: 'mark_unread' })}
          >
            {t('markUnread')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            data-testid="inbox-bulk-read"
            onClick={() => props.onRun({ type: 'mark_read' })}
          >
            {t('markRead')}
          </Button>
        )}
        {can.resolve && (
          <>
            {state.canMoveTo('resolved') && (
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled}
                data-testid="inbox-bulk-resolve"
                onClick={() => props.onRun({ type: 'status', status: 'resolved' })}
              >
                {t('resolve')}
              </Button>
            )}
            {state.canMoveTo('closed') && (
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled}
                data-testid="inbox-bulk-close"
                onClick={() => props.onRun({ type: 'status', status: 'closed' })}
              >
                {t('close')}
              </Button>
            )}
            {/* Reopen sends status open to every picked conversation: it would un-spam or wake the spam and snoozed ones among them, and no
                resolved web chat is reopened (`someFinishedWebchat`). */}
            {state.canMoveTo('open') &&
              !state.someSpam &&
              !state.someSnoozed &&
              !state.someFinishedWebchat && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  data-testid="inbox-bulk-reopen"
                  onClick={() => props.onRun({ type: 'status', status: 'open' })}
                >
                  {t('reopen')}
                </Button>
              )}
            {state.allSpam ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled}
                data-testid="inbox-bulk-not-spam"
                onClick={() => props.onRun({ type: 'status', status: 'open' })}
              >
                {t('notSpam')}
              </Button>
            ) : (
              !state.someFinishedWebchat && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  data-testid="inbox-bulk-spam"
                  onClick={() => props.onRun({ type: 'spam' })}
                >
                  {t('spam')}
                </Button>
              )
            )}
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
            {state.canAssignMe && <option value="me">{t('assignToMe')}</option>}
            {can.assign && state.canUnassign && <option value="none">{t('unassign')}</option>}
            {can.assign && state.canRemoveTeam && (
              <option value="no-team">{t('removeTeam')}</option>
            )}
            {can.assign &&
              assignees.data?.users
                .filter((u) => !u.isMe)
                .map((u) => (
                  <option key={u.id} value={`u:${u.id}`}>
                    {u.name ?? u.email} · {ta(`availability.${u.availability}`)}
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
        {can.snooze && !unsnoozeShown && !state.someFinishedWebchat && (
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
        {unsnoozeShown && (
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            data-testid="inbox-bulk-unsnooze"
            onClick={() => props.onRun({ type: 'status', status: 'open' })}
          >
            {t('unsnooze')}
          </Button>
        )}
        {can.tag && (
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
            {addTags.length > 0 && (
              <optgroup label={t('tagAdd')}>
                {addTags.map((l) => (
                  <option key={`a${l.id}`} value={`add:${l.id}`}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            )}
            {removeTags.length > 0 && (
              <optgroup label={t('tagRemove')}>
                {removeTags.map((l) => (
                  <option key={`r${l.id}`} value={`remove:${l.id}`}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        )}
        {props.busy && <Spinner />}
      </div>
    </div>
  );
}
