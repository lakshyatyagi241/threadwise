import {
  BULK_STATUS_TARGETS,
  CONVERSATION_PRIORITIES,
  type BulkConversationAction,
  type BulkConversationsResponse,
  type ConversationPriority,
} from '@crm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { messageForError } from '@/lib/api/error-message';
import { AssignSheet } from './assign-sheet';
import type { BulkKind } from './bulk-bar';
import { ChoiceSheet } from './choice-sheet';
import { SNOOZE_CHOICES, snoozeUntil, type SnoozeChoice } from './thread-actions';
import { useBulk } from './use-bulk';
import { useLabelLibrary } from './use-labels';

interface Props {
  /** Which action's sheet is open (`read` has none: it runs at once); null: none. */
  kind: BulkKind | null;
  /** The chosen conversations. */
  ids: readonly string[];
  onClose: () => void;
  /** The answer, when the run finished (some of them may still have failed: it says which). */
  onDone: (result: BulkConversationsResponse) => void;
}

/**
 * The sheets behind the bulk bar: pick a status, an agent or team, a label to add or take off, a priority or a snooze time, then
 * Save: one request for all the chosen conversations. A sheet stays open with the sentence when the whole request failed.
 */
export function BulkSheets({ kind, ids, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const bulk = useBulk();
  const labels = useLabelLibrary(kind === 'label');
  const [error, setError] = useState<string | null>(null);

  const run = (action: BulkConversationAction) => {
    setError(null);
    bulk.mutate(
      { ids, action },
      {
        onSuccess: (result) => {
          onDone(result);
          onClose();
        },
        onError: (e) => setError(messageForError(e, t)),
      },
    );
  };
  const close = () => {
    setError(null);
    onClose();
  };

  return (
    <>
      <ChoiceSheet
        visible={kind === 'status'}
        title={t('inbox.bulk.statusTitle', { count: ids.length })}
        groups={[
          {
            key: 'status',
            options: BULK_STATUS_TARGETS.map((s) => ({ value: s, label: t(`inbox.status.${s}`) })),
          },
        ]}
        initial={{ status: '' }}
        saving={bulk.isPending}
        error={error}
        onSave={(picked) =>
          run({ type: 'status', status: picked.status as (typeof BULK_STATUS_TARGETS)[number] })
        }
        onClose={close}
      />
      <AssignSheet
        visible={kind === 'assign'}
        bulk
        assignment={{ user: null, team: null, aiAgent: null }}
        saving={bulk.isPending}
        error={error}
        onSave={(change) => run({ type: 'assign', ...change })}
        onClose={close}
      />
      <ChoiceSheet
        visible={kind === 'label'}
        title={t('inbox.bulk.labelTitle', { count: ids.length })}
        groups={[
          {
            key: 'mode',
            title: t('inbox.bulk.labelMode'),
            options: [
              { value: 'add', label: t('inbox.bulk.labelAdd') },
              { value: 'remove', label: t('inbox.bulk.labelRemove') },
            ],
          },
          {
            key: 'label',
            title: t('inbox.details.labels'),
            options: (labels.data ?? []).map((l) => ({ value: l.id, label: l.name })),
          },
        ]}
        initial={{ mode: 'add', label: '' }}
        searchLabel={t('inbox.bulk.labelSearch')}
        loading={labels.isPending}
        loadError={labels.error ? messageForError(labels.error, t) : null}
        onRetry={() => void labels.refetch()}
        saving={bulk.isPending}
        error={error}
        isValid={(picked) => Boolean(picked.label)}
        onSave={(picked) =>
          run({
            type: 'label',
            mode: picked.mode === 'remove' ? 'remove' : 'add',
            tagId: picked.label ?? '',
          })
        }
        onClose={close}
      />
      <ChoiceSheet
        visible={kind === 'priority'}
        title={t('inbox.bulk.priorityTitle', { count: ids.length })}
        groups={[
          {
            key: 'priority',
            options: CONVERSATION_PRIORITIES.map((p) => ({
              value: p,
              label: t(`inbox.priority.${p}`),
            })),
          },
        ]}
        initial={{ priority: '' }}
        saving={bulk.isPending}
        error={error}
        onSave={(picked) =>
          run({ type: 'priority', priority: picked.priority as ConversationPriority })
        }
        onClose={close}
      />
      <ChoiceSheet
        visible={kind === 'snooze'}
        title={t('inbox.bulk.snoozeTitle', { count: ids.length })}
        groups={[
          {
            key: 'snooze',
            options: SNOOZE_CHOICES.map((c) => ({ value: c, label: t(`inbox.snooze.${c}`) })),
          },
        ]}
        initial={{ snooze: '' }}
        saving={bulk.isPending}
        error={error}
        onSave={(picked) =>
          // The time is worked out when the person presses Save, from the clock then.
          run({ type: 'snooze', until: snoozeUntil(picked.snooze as SnoozeChoice, new Date()) })
        }
        onClose={close}
      />
    </>
  );
}

/** Runs a bulk action that has no sheet (mark as read) for the chosen conversations. */
export function useBulkRead(
  onDone: (r: BulkConversationsResponse) => void,
  onFail: (message: string) => void,
) {
  const { t } = useTranslation();
  const bulk = useBulk();
  return {
    pending: bulk.isPending,
    run: (ids: readonly string[]) =>
      bulk.mutate(
        { ids, action: { type: 'mark_read' } },
        { onSuccess: onDone, onError: (e) => onFail(messageForError(e, t)) },
      ),
  };
}
