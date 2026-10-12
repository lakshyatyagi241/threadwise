import type { ContactResponse } from '@crm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { can, useSession } from '@/lib/session/use-session';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ContactActions } from './contact-actions';
import { displayName } from './contact-display';
import { useContactActions } from './use-contact-actions';

interface Props {
  /** The contact the sheet is for; null keeps it closed. */
  contact: ContactResponse | null;
  onClose: () => void;
  onEdit: (contact: ContactResponse) => void;
  onDelete: (contact: ContactResponse) => void;
}

/** What the three dots on a contact row open: the shortcuts, and edit and delete for the people who may. */
export function ContactActionsSheet({ contact, onClose, onEdit, onDelete }: Props) {
  // Keyed by the contact, so a note about one contact is never shown on the next one.
  return contact ? (
    <SheetBody
      key={contact.id}
      contact={contact}
      onClose={onClose}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  ) : null;
}

function SheetBody({
  contact,
  onClose,
  onEdit,
  onDelete,
}: Omit<Props, 'contact'> & { contact: ContactResponse }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const session = useSession();
  const [notice, setNotice] = useState<string | null>(null);
  const actions = useContactActions(contact, setNotice);
  const canUpdate = can(session.data, 'record.contacts.update');
  const canDelete = can(session.data, 'record.contacts.delete');

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('contacts.sheet.close')}
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
        onPress={onClose}
      >
        <Pressable
          accessible={false}
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="heading" numberOfLines={1} accessibilityRole="header">
            {displayName(contact, t)}
          </Text>
          {notice ? <Banner tone="warning" message={notice} /> : null}
          <ContactActions actions={actions} />
          <View style={styles.buttons}>
            {canUpdate ? (
              <Button
                variant="secondary"
                label={t('contacts.edit.open')}
                onPress={() => onEdit(contact)}
              />
            ) : null}
            {canDelete ? (
              <Button
                variant="secondary"
                label={t('contacts.detail.delete.open')}
                onPress={() => onDelete(contact)}
              />
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    gap: spacing.lg,
    padding: spacing.xl,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttons: { gap: spacing.sm },
});
