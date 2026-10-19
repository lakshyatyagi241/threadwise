'use client';

import { Alert, Button, Field, Modal, Select, Spinner, useToast } from '@crm/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAllMembers } from '../api/hooks';
import { wspApi } from '../api/service';
import { canConfirm, handoverInput, heldTotal, type HandoverChoice } from '../lib/handover';
import { useErrorText } from './parts';

/**
 * "Deactivate member" (Teams v2, decision D10). Before somebody goes, ask what happens to the contacts and open deals they own and
 * to their open conversations: give them to a person, to the person's team manager, or leave them. The team places of the person
 * are kept, so reactivating them puts them back on their teams. `onConfirm` does the deactivation itself (the roles screen's status
 * change, or the older Remove); it runs after the hand-over, which is why a failed hand-over stops here with the person still active.
 */
export function DeactivateDialog({
  member,
  busy = false,
  onConfirm,
  onClose,
}: {
  member: { id: string; fullName: string } | null;
  /** The caller is already deactivating (its own request is in flight). */
  busy?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.deactivate');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  return (
    <Modal
      open={member !== null}
      onClose={onClose}
      eyebrow={t('eyebrow')}
      title={t('title')}
      closeLabel={tc('close')}
    >
      {/* Mounted per person, so every opening asks again from a clean slate. */}
      {member && (
        <DeactivateBody key={member.id} member={member} busy={busy} onConfirm={onConfirm} onClose={onClose} />
      )}
    </Modal>
  );
}

function DeactivateBody({
  member,
  busy: outerBusy,
  onConfirm,
  onClose,
}: {
  member: { id: string; fullName: string };
  busy: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.deactivate');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  const { toast } = useToast();
  const errorText = useErrorText();
  const everyone = useAllMembers(true);

  const preview = useQuery({
    queryKey: ['workspaces-teams-tenancy', 'handover', member.id],
    queryFn: ({ signal }) => wspApi.handoverPreview(member.id, signal),
    retry: false,
  });
  const data = preview.data;
  const holds = data ? heldTotal(data) > 0 : false;

  const [choice, setChoice] = useState<HandoverChoice>('person');
  const [userId, setUserId] = useState('');
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // "Their team manager" is the natural first choice when there is one.
  const hasLead = (data?.teamLeads.length ?? 0) > 0;
  useEffect(() => {
    if (hasLead) setChoice('team_lead');
  }, [hasLead]);

  const candidates = everyone.items.filter((m) => m.status === 'active' && m.id !== member.id);

  async function confirm() {
    setWorking(true);
    setFailure(null);
    try {
      const input = handoverInput(choice, userId, data);
      if (input) {
        const done = await wspApi.handover(member.id, input);
        toast(
          t('moved', {
            contacts: done.movedContacts,
            deals: done.movedDeals,
            chats: done.movedConversations,
            name: done.toUser?.fullName ?? '',
          }),
        );
        if (done.remaining > 0) toast(t('remaining', { count: done.remaining }), 'info');
      }
      await onConfirm();
    } catch (err) {
      setFailure(errorText(err));
    } finally {
      setWorking(false);
    }
  }

  const loading = preview.isPending;
  const disabled = working || outerBusy || loading || !canConfirm(choice, userId, data);

  return (
    <div className="space-y-4" data-testid="deactivate-dialog">
      <p className="text-sm">{t('message', { name: member.fullName })}</p>

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner /> {t('loading')}
        </p>
      ) : preview.isError ? (
        <Alert tone="warning">{t('previewFailed')}</Alert>
      ) : holds && data ? (
        <fieldset className="space-y-3 text-sm" data-testid="handover-options">
          <legend className="mb-1 font-medium">
            {t('holds', {
              name: member.fullName,
              contacts: data.contacts,
              deals: data.openDeals,
              chats: data.openConversations,
            })}
          </legend>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="handover"
              checked={choice === 'team_lead'}
              disabled={!hasLead}
              onChange={() => setChoice('team_lead')}
              data-testid="handover-team-lead"
              className="mt-1 accent-[var(--primary)]"
            />
            <span>
              {hasLead
                ? t('optLead', { name: data.teamLeads[0]!.fullName, team: data.teamLeads[0]!.teamName })
                : t('optLeadNone')}
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="handover"
              checked={choice === 'person'}
              onChange={() => setChoice('person')}
              data-testid="handover-person"
              className="mt-1 accent-[var(--primary)]"
            />
            <span className="flex-1">{t('optPerson')}</span>
          </label>
          {choice === 'person' && (
            <Field label={t('pickPerson')} htmlFor="handover-user">
              <Select
                id="handover-user"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                data-testid="handover-user"
              >
                <option value="">{t('pickPlaceholder')}</option>
                {candidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="handover"
              checked={choice === 'leave'}
              onChange={() => setChoice('leave')}
              data-testid="handover-leave"
              className="mt-1 accent-[var(--primary)]"
            />
            <span>{t('optLeave', { name: member.fullName })}</span>
          </label>
          <p className="text-xs text-muted-foreground">{t('undoNote')}</p>
        </fieldset>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="handover-nothing">
          {t('nothing', { name: member.fullName })}
        </p>
      )}

      <p className="text-xs text-muted-foreground">{t('membership', { name: member.fullName })}</p>

      {failure && (
        <Alert tone="danger" data-testid="deactivate-error">
          {failure}
        </Alert>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={working}>
          {tc('cancel')}
        </Button>
        <Button
          variant="danger"
          onClick={() => void confirm()}
          disabled={disabled}
          data-testid="deactivate-confirm"
        >
          {(working || outerBusy) && <Spinner />}
          {t('confirm')}
        </Button>
      </div>
    </div>
  );
}
