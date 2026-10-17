'use client';

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useToast } from '@crm/ui';
import { useStatusOptions } from '../api/attributes';
import { invalidateContacts, KEYS, updateContact } from '../api/contacts';
import type { ContactRow } from '../api/schemas';
import { titleCaseKey } from '../lib/contact-model';
import { errorKind } from '../lib/errors';
import { stageChoices, statusChoices, type Choice } from '../lib/option-sets';
import { isLostStage } from '../lib/stage-flow';
import { stageDefaultStatus, statusAfterMove, statusNotice } from '../lib/status-scope';
import { LostReasonDialog, type LostPrompt } from './lost-reason';

/** How long the "Undo" stays on screen. */
export const UNDO_MS = 8000;

/** The contact a stage move starts from: what the screen last read (the row version makes a stale move a conflict, not an overwrite). */
export interface StageTarget {
  id: string;
  name: string;
  rowVersion: number;
  stage: string | null;
  status: string | null;
}

export interface StageMoveTo {
  stage: string;
  /** A status the person picked under the stage; absent = the API's rule (the stage's default, or the status kept when it still fits); `null` clears it. */
  status?: string | null;
}

type Cached = { response?: { data?: ContactRow[] } } | undefined;

/**
 * Moving a contact to another lifecycle stage (and, when the person picks one, status), shared by every stage control: the record page,
 * the quick view, the list, the board and the bulk bar's single moves. The screen changes at once and goes back with the reason if
 * the server refuses; a lost stage asks why first; the toast says what happened to the status (the server's answer) and offers
 * "Undo" for eight seconds, which moves the contact back to the stage and status it came from. The status linking rules are the
 * API's, mirrored in `lib/status-scope`.
 */
export function useStageMove() {
  const ts = useTranslations('contacts-attributes-tags.stageMenu');
  const tf = useTranslations('contacts-attributes-tags.form');
  const tr = useTranslations('contacts-attributes-tags.contact.record.stagePicker');
  const qc = useQueryClient();
  const { toast, dismiss } = useToast();
  const options = useStatusOptions();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lost, setLost] = useState<LostPrompt | null>(null);
  const waiting = useRef<{ target: StageTarget; to: StageMoveTo } | null>(null);

  const stages = useMemo(() => stageChoices(options.data), [options.data]);
  const stageLabel = useCallback(
    (v: string) => stages.find((s) => s.value === v)?.label ?? titleCaseKey(v),
    [stages],
  );
  const statusLabel = useCallback(
    (v: string) =>
      statusChoices(options.data, (x) => tf(`statuses.${x}`)).find((c) => c.value === v)?.label ??
      titleCaseKey(v),
    [options.data, tf],
  );
  /** The statuses a person may choose in a stage (the ones scoped to other stages are left out). */
  const statusesOf = useCallback(
    (stage: string): Choice[] =>
      statusChoices(options.data, (x) => tf(`statuses.${x}`), undefined, stage),
    [options.data, tf],
  );
  /** What moving a contact holding `status` to `stage` does to the status, as words ("Status becomes X"); null = nothing. */
  const hintFor = useCallback(
    (status: string | null, stage: string): string | null => {
      const move = statusAfterMove(options.data, status, stage);
      if (!move.changed) return null;
      return move.status === null
        ? ts('willClear')
        : ts('willReset', { status: statusLabel(move.status) });
    },
    [options.data, ts, statusLabel],
  );
  const defaultStatusOf = useCallback(
    (stage: string) => stageDefaultStatus(options.data, stage),
    [options.data],
  );

  const patchCaches = (target: StageTarget, to: StageMoveTo) => {
    const status =
      to.status !== undefined
        ? to.status
        : statusAfterMove(options.data, target.status, to.stage).status;
    const patch = (r: ContactRow): ContactRow =>
      r.id === target.id ? { ...r, lifecycleStage: to.stage, status } : r;
    const before = {
      contact: qc.getQueryData<ContactRow>(KEYS.contact(target.id)),
      lists: qc.getQueriesData<Cached>({ queryKey: KEYS.contacts }),
    };
    if (before.contact) qc.setQueryData<ContactRow>(KEYS.contact(target.id), patch(before.contact));
    qc.setQueriesData<Cached>({ queryKey: KEYS.contacts }, (old) =>
      old?.response?.data
        ? { ...old, response: { ...old.response, data: old.response.data.map(patch) } }
        : old,
    );
    return () => {
      qc.setQueryData(KEYS.contact(target.id), before.contact);
      for (const [key, data] of before.lists) qc.setQueryData(key, data);
    };
  };

  const move = useCallback(
    async (
      target: StageTarget,
      to: StageMoveTo,
      reason?: { lostReason?: string | null; otherLostReason?: string | null },
      undoing = false,
    ): Promise<boolean> => {
      const sameStage = to.stage === target.stage;
      if (sameStage && (to.status === undefined || to.status === target.status)) return true;
      // A lost stage asks why first; nothing is saved until the dialog gives a reason.
      if (!sameStage && !reason && !undoing && isLostStage(stages, to.stage)) {
        waiting.current = { target, to };
        setLost({
          contactId: target.id,
          contactName: target.name,
          stageValue: to.stage,
          stageLabel: stageLabel(to.stage),
        });
        return false;
      }
      setBusyId(target.id);
      const rollback = patchCaches(target, to);
      try {
        const saved = await updateContact(target.id, {
          ...(sameStage ? {} : { lifecycleStage: to.stage }),
          ...(to.status !== undefined ? { status: to.status } : {}),
          ...reason,
          rowVersion: target.rowVersion,
        });
        setLost(null);
        waiting.current = null;
        await Promise.all([
          invalidateContacts(qc),
          qc.invalidateQueries({ queryKey: KEYS.contact(target.id) }),
        ]);
        const name = stageLabel(to.stage);
        if (undoing) {
          toast(tr('undone', { stage: name }), 'success');
          return true;
        }
        // The API keeps the status valid for the stage: say what happened to it, from its answer.
        const notice = statusNotice(target.status, saved.status);
        const said = sameStage
          ? tr('statusSet', { status: statusLabel(saved.status ?? '') })
          : notice.kind === 'none'
            ? ts('changed', { stage: name })
            : notice.kind === 'cleared'
              ? ts('changedStatusCleared', { stage: name })
              : ts(notice.kind === 'reset' ? 'changedStatusReset' : 'changedStatusSet', {
                  stage: name,
                  status: statusLabel(notice.status),
                });
        const id: { current: number } = { current: 0 };
        const undo: ReactNode =
          target.stage === null ? (
            said
          ) : (
            <span className="flex flex-wrap items-center gap-x-3">
              <span>{said}</span>
              <button
                type="button"
                className="rounded font-semibold underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => {
                  dismiss(id.current);
                  void move(
                    {
                      ...target,
                      rowVersion: saved.rowVersion,
                      stage: saved.lifecycleStage,
                      status: saved.status,
                    },
                    { stage: target.stage!, status: target.status },
                    undefined,
                    true,
                  );
                }}
              >
                {tr('undo')}
              </button>
            </span>
          );
        id.current = toast(undo, 'success', { durationMs: UNDO_MS });
        return true;
      } catch (e) {
        rollback();
        const kind = errorKind(e);
        toast(
          ts(kind === 'conflict' ? 'conflict' : kind === 'forbidden' ? 'forbidden' : 'failed'),
          'danger',
        );
        if (kind === 'conflict') await invalidateContacts(qc);
        return false;
      } finally {
        setBusyId(null);
      }
    },
    // `patchCaches` closes over the options and the client only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stages, stageLabel, statusLabel, options.data, qc, toast, dismiss, ts, tr],
  );

  const dialog = (
    <LostReasonDialog
      prompt={lost}
      busy={busyId !== null}
      onConfirm={(_p, reason) => {
        const w = waiting.current;
        if (w) void move(w.target, w.to, reason);
      }}
      onClose={() => {
        waiting.current = null;
        setLost(null);
      }}
    />
  );

  return {
    move,
    busyId,
    dialog,
    stages,
    stageLabel,
    statusLabel,
    statusesOf,
    hintFor,
    defaultStatusOf,
  };
}
