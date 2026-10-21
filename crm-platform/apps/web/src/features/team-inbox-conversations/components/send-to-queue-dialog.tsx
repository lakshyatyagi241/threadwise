'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { HANDOFF_REASONS, type ConversationSummary, type HandoffReason } from '@crm/contracts';
import { Alert, Button, Field, Modal, Select, Spinner, Textarea, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { useAssignees } from '../api/hooks';
import { useHandoffActions, useHandoffSettings } from '../api/handoff';
import {
  EMPTY_SEND,
  sendReady,
  toSendInput,
  type QueueDestinationKind,
  type SendDraft,
} from '../lib/handoff';

/**
 * "Send to queue" (BL-396): a person asks for the same handoff a flow or an AI agent makes. They say where it goes (the workspace's
 * assignment rules, a team, or one person), why, and a note for whoever takes it; the bot stops answering and the thread shows in the
 * "Waiting for a person" tab unless somebody could take it at once.
 */
export function SendToQueueDialog({
  conversationId,
  onClose,
  onPlaced,
}: {
  conversationId: string;
  onClose: () => void;
  onPlaced: (row: ConversationSummary) => void;
}) {
  const t = useTranslations('team-inbox-conversations.handoff');
  const { toast } = useToast();
  const { send } = useHandoffActions(conversationId);
  const assignees = useAssignees(true);
  const canReadSettings = useCan('inbox.settings.read');
  const settings = useHandoffSettings(canReadSettings);
  const [draft, setDraft] = useState<SendDraft>(EMPTY_SEND);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<SendDraft>) => setDraft((d) => ({ ...d, ...patch }));
  // Without the plan feature the rules cannot run: the thread then waits in the queue, which the label says before the click.
  const rulesAvailable = settings.data?.available.autoAssign !== false;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!sendReady(draft)) return;
    setProblem(null);
    send.mutate(toSendInput(draft), {
      onSuccess: (r) => {
        if (r.refused) {
          setProblem(t('send.refused'));
          return;
        }
        onPlaced(r.conversation);
        toast(t(`send.done.${r.outcome}`));
        onClose();
      },
      onError: (err) =>
        setProblem(err instanceof ApiError && err.message ? err.message : t('send.failed')),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('send.title')}
      size="sm"
      closeLabel={t('send.close')}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('send.cancel')}
          </Button>
          <Button
            type="submit"
            form="inbox-send-queue-form"
            data-testid="inbox-send-queue-submit"
            disabled={send.isPending || !sendReady(draft)}
          >
            {send.isPending ? <Spinner /> : t('send.submit')}
          </Button>
        </div>
      }
    >
      <form id="inbox-send-queue-form" onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('send.intro')}</p>
        <Field label={t('send.where')} htmlFor="hq-where">
          <Select
            id="hq-where"
            value={draft.kind}
            onChange={(e) => set({ kind: e.target.value as QueueDestinationKind })}
          >
            <option value="rules">
              {rulesAvailable ? t('send.whereRules') : t('send.whereQueueOnly')}
            </option>
            <option value="team">{t('send.whereTeam')}</option>
            <option value="person">{t('send.wherePerson')}</option>
          </Select>
        </Field>
        {draft.kind === 'team' && (
          <Field label={t('send.team')} htmlFor="hq-team">
            <Select
              id="hq-team"
              value={draft.teamId}
              onChange={(e) => set({ teamId: e.target.value })}
            >
              <option value="">{t('send.pickTeam')}</option>
              {(assignees.data?.teams ?? []).map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {draft.kind === 'person' && (
          <Field label={t('send.person')} htmlFor="hq-person">
            <Select
              id="hq-person"
              value={draft.userId}
              onChange={(e) => set({ userId: e.target.value })}
            >
              <option value="">{t('send.pickPerson')}</option>
              {(assignees.data?.users ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('send.reason')} htmlFor="hq-reason">
          <Select
            id="hq-reason"
            value={draft.reason}
            onChange={(e) => set({ reason: e.target.value as HandoffReason })}
          >
            {HANDOFF_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`reason.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('send.note')} htmlFor="hq-note" hint={t('send.noteHint')}>
          <Textarea
            id="hq-note"
            rows={3}
            maxLength={500}
            value={draft.note}
            onChange={(e) => set({ note: e.target.value })}
          />
        </Field>
        {problem && <Alert tone="danger">{problem}</Alert>}
      </form>
    </Modal>
  );
}
