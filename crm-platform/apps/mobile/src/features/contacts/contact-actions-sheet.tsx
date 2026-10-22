import type { ContactResponse } from '@crm/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Text } from '@/components/ui/text';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ContactActions, type ContactAction } from './contact-actions';
import { displayName } from './contact-display';
import { LifecycleSheet } from './lifecycle-card';
import { OwnerPicker } from './owner-picker';
import { useContactActions } from './use-contact-actions';
import { useStatusOptions } from './use-properties';
import { WhatsappActionModal } from './whatsapp-action-modal';

interface Props {
  /** The contact the sheet is for; null keeps it closed. */
  contact: ContactResponse | null;
  onClose: () => void;
  onEdit: (contact: ContactResponse) => void;
  onDelete: (contact: ContactResponse) => void;
}

/**
 * What the three dots on a contact row open (the Geta app's sheet): call, WhatsApp, email and message, then task, note, edit and
 * delete, and under them the contact owner and the lifecycle stage. What the person may not do stays in place, faded. WhatsApp asks
 * first whether to open the app or send a template; owner and stage open the same editors the contact's own screen has.
 */
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
  const router = useRouter();
  const session = useSession();
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'whatsapp' | 'owner' | 'stage' | null>(null);
  const shortcuts = useContactActions(contact, setNotice);
  const canUpdate = can(session.data, 'record.contacts.update');
  const canDelete = can(session.data, 'record.contacts.delete');
  const canReadOptions = can(session.data, 'record.contact-properties.read');
  const statusOptions = useStatusOptions(canUpdate && canReadOptions);

  const shortcut = (key: string) => shortcuts.find((a) => a.key === key);
  const call = shortcut('call');
  const email = shortcut('email');
  const sms = shortcut('sms');
  // Task and note open the screens that add one for this contact and close the sheet, so Back returns to the list.
  const leave = (href: Parameters<typeof router.push>[0]) => {
    onClose();
    router.push(href);
  };
  const actions: ContactAction[] = [
    ...(call ? [call] : []),
    {
      key: 'whatsapp',
      icon: 'logo-whatsapp',
      color: 'whatsapp',
      label: t('inbox.channel.whatsapp'),
      disabled: !contact.phone,
      onPress: () => setDialog('whatsapp'),
    },
    ...(email ? [email] : []),
    ...(sms ? [{ ...sms, label: t('inbox.kind.text') }] : []),
    {
      key: 'task',
      icon: 'checkbox-outline',
      label: t('deals.timeline.types.task'),
      disabled: !can(session.data, 'record.tasks.create'),
      onPress: () => leave({ pathname: '/task-form', params: { contactId: contact.id } }),
    },
    {
      key: 'note',
      icon: 'document-text-outline',
      label: t('deals.timeline.types.note'),
      disabled: !canUpdate,
      onPress: () => leave({ pathname: '/contact-note', params: { contactId: contact.id } }),
    },
    {
      key: 'edit',
      icon: 'create-outline',
      label: t('contacts.row.swipeEdit'),
      disabled: !canUpdate,
      onPress: () => onEdit(contact),
    },
    {
      key: 'delete',
      icon: 'trash-outline',
      label: t('contacts.row.swipeDelete'),
      disabled: !canDelete,
      onPress: () => onDelete(contact),
    },
  ];
  const stageEditable = canUpdate && canReadOptions && statusOptions.isSuccess;

  return (
    <>
      <Modal transparent visible={dialog === null} animationType="slide" onRequestClose={onClose}>
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
            <Text
              variant="heading"
              numberOfLines={1}
              accessibilityRole="header"
              style={styles.title}
            >
              {displayName(contact, t)}
            </Text>
            <View style={[styles.rule, { backgroundColor: colors.border }]} />
            {notice ? <Banner tone="warning" message={notice} /> : null}
            <View style={styles.grid}>
              <ContactActions actions={actions.slice(0, 4)} />
              <ContactActions actions={actions.slice(4)} />
            </View>
            <View style={[styles.footer, { borderTopColor: colors.border }]}>
              <FooterButton
                label={t('contactProps.fields.owner')}
                disabled={!canUpdate}
                onPress={() => setDialog('owner')}
              />
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <FooterButton
                label={t('contacts.detail.stage')}
                disabled={!stageEditable}
                onPress={() => setDialog('stage')}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      {dialog === 'whatsapp' ? (
        <WhatsappActionModal contact={contact} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'owner' ? (
        <OwnerPicker contact={contact} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'stage' ? (
        <LifecycleSheet
          contact={contact}
          options={statusOptions.data ?? []}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

function FooterButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.footerButton, disabled && styles.faded]}
    >
      <Text variant="label" muted numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    gap: spacing.lg,
    paddingTop: spacing.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  title: { textAlign: 'center', paddingHorizontal: spacing.xl },
  rule: { height: StyleSheet.hairlineWidth },
  grid: { gap: spacing.xl, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  footer: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.sm,
  },
  footerButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET + spacing.md,
  },
  divider: { width: StyleSheet.hairlineWidth, marginVertical: spacing.sm },
  faded: { opacity: 0.4 },
});
