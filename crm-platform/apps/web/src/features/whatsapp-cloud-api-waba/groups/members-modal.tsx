'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { WABA_GROUP_REMOVE_MAX, type WabaGroup } from '@crm/contracts';
import { Alert, Button, Checkbox, ConfirmDialog, Modal, Spinner } from '@crm/ui';
import { useGroupMembers, useRemoveParticipants } from '../api/groups-hooks';
import { useErrorText } from '../components/use-error-text';
import { toggleSelected, type GroupNotice } from './groups-model';

/**
 * The members of a group and a remove action capped at 8 per request. Reference has the route but no screen and stores no members (spec D3,
 * an intended addition): the list is read from Meta each time this window opens and kept nowhere, because it is personal data.
 */
export function MembersModal({
  number,
  group,
  open,
  onClose,
  onNotice,
}: {
  number: string;
  group: WabaGroup;
  open: boolean;
  onClose: () => void;
  onNotice: (n: GroupNotice) => void;
}) {
  const t = useTranslations('whatsapp-cloud-api-waba.groups');
  const errorText = useErrorText();
  const members = useGroupMembers(number, group.id, open);
  const remove = useRemoveParticipants(number);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);

  const list = members.data?.members ?? [];
  const full = selected.length >= WABA_GROUP_REMOVE_MAX;

  const doRemove = () =>
    remove.mutate(
      { group: group.id, input: { participants: selected } },
      {
        onSuccess: (r) => {
          setConfirm(false);
          setSelected([]);
          onNotice({ tone: 'success', text: t('notice.removed', { count: r.removed }) });
          void members.refetch();
        },
        onError: (err) => {
          setConfirm(false);
          const et = errorText(err);
          onNotice({ tone: 'danger', text: et.text, requestId: et.requestId });
        },
      },
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('members.title', { name: group.subject ?? t('list.untitled') })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('confirm.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={selected.length === 0 || remove.isPending}
            onClick={() => setConfirm(true)}
          >
            {remove.isPending ? t('members.removing') : t('members.remove')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        {t('members.hint', { max: WABA_GROUP_REMOVE_MAX })}
      </p>
      <div className="mt-3">
        {members.isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> {t('members.loading')}
          </div>
        ) : members.isError ? (
          <Alert tone="danger">{errorText(members.error).text}</Alert>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('members.empty')}</p>
        ) : (
          <>
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {list.map((m) => (
                <li key={m.waId}>
                  <Checkbox
                    id={`wg-member-${m.waId}`}
                    label={<span dir="ltr">{m.waId}</span>}
                    checked={selected.includes(m.waId)}
                    disabled={full && !selected.includes(m.waId)}
                    onChange={() => setSelected((s) => toggleSelected(s, m.waId))}
                  />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              {t('members.selected', { count: selected.length })}
              {full && ` · ${t('members.limit', { max: WABA_GROUP_REMOVE_MAX })}`}
            </p>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        title={t('members.remove')}
        message={t('members.removeConfirm', { count: selected.length })}
        confirmLabel={t('members.remove')}
        cancelLabel={t('confirm.cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={doRemove}
        onClose={() => setConfirm(false)}
      />
    </Modal>
  );
}
