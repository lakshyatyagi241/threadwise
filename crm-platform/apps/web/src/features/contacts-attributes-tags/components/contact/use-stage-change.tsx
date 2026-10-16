'use client';

import { useMutation } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@crm/ui';
import { useStatusOptions } from '../../api/attributes';
import { updateContact } from '../../api/contacts';
import type { ContactRow } from '../../api/schemas';
import { displayName, titleCaseKey } from '../../lib/contact-model';
import { errorKind } from '../../lib/errors';
import { stageChoices, statusChoices, type Choice } from '../../lib/option-sets';
import { isLostStage } from '../../lib/stage-flow';
import { statusAfterMove, statusNotice } from '../../lib/status-scope';
import { LostReasonDialog, type LostPrompt } from '../lost-reason';
import { useRefreshContact } from './shared';

export interface StageChange {
  stages: Choice[];
  /** The statuses valid in the contact's current stage (the status bar). */
  statuses: Choice[];
  statusLabel: (value: string) => string;
  /** What moving to `stage` does to the status the contact holds ("Status becomes X"); null = nothing. */
  hint: (stage: string) => string | null;
  /** Moves the contact to a stage; a lost stage asks for the reason first. */
  changeStage: (stage: string) => void;
  /** Sets the status within the current stage. */
  changeStatus: (status: string) => void;
  busy: boolean;
  /** The lost-reason dialog; render it once beside the control that calls `changeStage`. */
  dialog: ReactNode;
}

/**
 * Changing a contact's lifecycle stage and status, shared by the quick view and the details page: the stage change keeps the status
 * valid (the API does it and the toast says what happened to it), a lost stage asks why first, and a stale row version is
 * reported instead of overwritten.
 */
export function useStageChange(contact: ContactRow): StageChange {
  const ts = useTranslations('contacts-attributes-tags.stageMenu');
  const tf = useTranslations('contacts-attributes-tags.form');
  const tc = useTranslations('contacts-attributes-tags.contact.stages');
  const { toast } = useToast();
  const options = useStatusOptions();
  const refresh = useRefreshContact(contact.id);
  const [lost, setLost] = useState<LostPrompt | null>(null);

  const stages = useMemo(
    () => stageChoices(options.data, contact.lifecycleStage ?? undefined),
    [options.data, contact.lifecycleStage],
  );
  const statuses = useMemo(
    () =>
      statusChoices(
        options.data,
        (v) => tf(`statuses.${v}`),
        contact.status ?? undefined,
        contact.lifecycleStage ?? '',
      ),
    [options.data, tf, contact.status, contact.lifecycleStage],
  );
  const statusLabel = (v: string) =>
    statusChoices(options.data, (x) => tf(`statuses.${x}`)).find((c) => c.value === v)?.label ??
    titleCaseKey(v);

  const stageMutation = useMutation({
    mutationFn: (v: {
      stage: string;
      reason?: { lostReason?: string | null; otherLostReason?: string | null };
    }) =>
      updateContact(contact.id, {
        lifecycleStage: v.stage,
        ...v.reason,
        rowVersion: contact.rowVersion,
      }),
    onSuccess: async (saved) => {
      setLost(null);
      await refresh();
      const stageName =
        stages.find((s) => s.value === saved.lifecycleStage)?.label ?? saved.lifecycleStage ?? '';
      // The API keeps the status valid for the stage: say what happened to it, from its answer.
      const notice = statusNotice(contact.status, saved.status);
      toast(
        notice.kind === 'none'
          ? ts('changed', { stage: stageName })
          : notice.kind === 'cleared'
            ? ts('changedStatusCleared', { stage: stageName })
            : ts(notice.kind === 'reset' ? 'changedStatusReset' : 'changedStatusSet', {
                stage: stageName,
                status: statusLabel(notice.status),
              }),
        'success',
      );
    },
    onError: async (e) => {
      const kind = errorKind(e);
      toast(
        ts(kind === 'conflict' ? 'conflict' : kind === 'forbidden' ? 'forbidden' : 'failed'),
        'danger',
      );
      if (kind === 'conflict') await refresh();
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      updateContact(contact.id, { status, rowVersion: contact.rowVersion }),
    onSuccess: async (saved) => {
      await refresh();
      toast(tc('statusChanged', { status: statusLabel(saved.status ?? '') }), 'success');
    },
    onError: async (e) => {
      const kind = errorKind(e);
      toast(
        tc(kind === 'conflict' ? 'conflict' : kind === 'forbidden' ? 'forbidden' : 'statusFailed'),
        'danger',
      );
      if (kind === 'conflict') await refresh();
    },
  });

  return {
    stages,
    statuses,
    statusLabel,
    hint: (stage) => {
      const move = statusAfterMove(options.data, contact.status, stage);
      if (!move.changed) return null;
      return move.status === null
        ? ts('willClear')
        : ts('willReset', { status: statusLabel(move.status) });
    },
    changeStage: (stage) => {
      if (stage === contact.lifecycleStage) return;
      // A lost stage asks why first; nothing is saved until the dialog gives a reason.
      if (isLostStage(stages, stage)) {
        setLost({
          contactId: contact.id,
          contactName: displayName(contact),
          stageValue: stage,
          stageLabel: stages.find((x) => x.value === stage)?.label ?? stage,
        });
      } else stageMutation.mutate({ stage });
    },
    changeStatus: (status) => {
      if (status !== contact.status) statusMutation.mutate(status);
    },
    busy: stageMutation.isPending || statusMutation.isPending,
    dialog: (
      <LostReasonDialog
        prompt={lost}
        busy={stageMutation.isPending}
        onConfirm={(p, reason) => stageMutation.mutate({ stage: p.stageValue, reason })}
        onClose={() => setLost(null)}
      />
    ),
  };
}
