import type { ContactResponse } from '@crm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { ChoiceRow, EditSheet } from './field-editor';
import { useAssignees, useSetOwner } from './use-properties';

interface Props {
  contact: ContactResponse;
  onClose: () => void;
}

/**
 * Who owns the contact: the workspace's active staff plus "Unassigned", the current owner ticked. Choosing someone only moves the
 * tick; the check in the header saves. A contact the API could not hand over comes back in the body of an otherwise successful
 * answer, and is shown as an error here, not mistaken for a save.
 */
export function OwnerPicker({ contact, onClose }: Props) {
  const { t } = useTranslation();
  const assignees = useAssignees(true);
  const setOwner = useSetOwner(contact.id);
  const [pick, setPick] = useState<string | null>(contact.ownerId);
  const [banner, setBanner] = useState<string | null>(null);

  const save = () => {
    setBanner(null);
    if (pick === contact.ownerId) {
      onClose();
      return;
    }
    setOwner.mutate(pick, {
      onSuccess: (result) => {
        if (result.succeeded.includes(contact.id) && result.failed.length === 0) onClose();
        else setBanner(t('contactProps.owner.failed'));
      },
      onError: (error) => setBanner(messageForError(error, t)),
    });
  };

  const choose = (ownerId: string | null) => {
    setPick(ownerId);
    setBanner(null);
  };

  let list;
  if (assignees.isPending) {
    list = <ActivityIndicator accessibilityLabel={t('common.loading')} />;
  } else if (assignees.isError) {
    list = (
      <View>
        <Banner tone="danger" message={messageForError(assignees.error, t)} />
        <Button variant="link" label={t('common.retry')} onPress={() => void assignees.refetch()} />
      </View>
    );
  } else {
    list = (
      <View accessibilityRole="radiogroup">
        <ChoiceRow
          label={t('contactProps.owner.unassigned')}
          role="radio"
          selected={pick === null}
          onPress={() => choose(null)}
        />
        {assignees.data.map((person) => (
          <ChoiceRow
            key={person.id}
            label={person.fullName}
            hint={person.email}
            role="radio"
            selected={pick === person.id}
            onPress={() => choose(person.id)}
          />
        ))}
        {assignees.data.length === 0 ? <Text muted>{t('contactProps.owner.none')}</Text> : null}
      </View>
    );
  }

  return (
    <EditSheet
      title={t('contactProps.owner.title')}
      onClose={onClose}
      onSave={save}
      saving={setOwner.isPending}
      saveDisabled={!assignees.isSuccess}
    >
      {banner ? <Banner tone="danger" message={banner} /> : null}
      {list}
    </EditSheet>
  );
}
