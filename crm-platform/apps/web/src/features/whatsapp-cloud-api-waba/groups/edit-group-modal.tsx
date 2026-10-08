'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { WABA_GROUP_DESCRIPTION_MAX, WABA_GROUP_SUBJECT_MAX, type WabaGroup } from '@crm/contracts';
import { Button, Field, Input, Modal, Textarea } from '@crm/ui';
import { useUpdateGroup } from '../api/groups-hooks';
import { useErrorText } from '../components/use-error-text';
import { editPatch, type GroupNotice } from './groups-model';

/**
 * Edit the subject and description. Reference has the route but no control (spec D3, recorded as an intended addition): this one says what
 * really happens, that the change is sent to WhatsApp and lands here only when Meta confirms each field.
 */
export function EditGroupModal({
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
  const update = useUpdateGroup(number);
  const [subject, setSubject] = useState(group.subject ?? '');
  const [description, setDescription] = useState(group.description ?? '');
  const patch = editPatch(group, { subject, description });

  const save = () => {
    if (!patch || update.isPending) return;
    update.mutate(
      { group: group.id, input: patch },
      {
        onSuccess: () => {
          onClose();
          onNotice({ tone: 'success', text: t('notice.updateSent') });
        },
        onError: (err) => {
          const et = errorText(err);
          onNotice({ tone: 'danger', text: et.text, requestId: et.requestId });
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('edit.title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('confirm.cancel')}
          </Button>
          <Button disabled={!patch || update.isPending} onClick={save}>
            {update.isPending ? t('edit.saving') : t('edit.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('edit.subject')} htmlFor="wg-edit-subject">
          <Input
            id="wg-edit-subject"
            value={subject}
            maxLength={WABA_GROUP_SUBJECT_MAX}
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>
        <Field label={t('edit.description')} htmlFor="wg-edit-description" hint={t('edit.hint')}>
          <Textarea
            id="wg-edit-description"
            rows={3}
            value={description}
            maxLength={WABA_GROUP_DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
