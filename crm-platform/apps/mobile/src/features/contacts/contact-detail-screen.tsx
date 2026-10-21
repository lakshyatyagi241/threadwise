import { ERROR_CODES, type ContactResponse, type UpdateContactInput } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { HeaderIconButton } from '@/components/ui/screen-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Text } from '@/components/ui/text';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { AboutTab } from './about-tab';
import { ActivitiesTab } from './activities-tab';
import { ContactForm, valuesOf } from './contact-form';
import { contactLine, displayName } from './contact-display';
import { describeContactFailure } from './contact-errors';
import { ContactHero } from './contact-hero';
import { normalisePhone, type ContactFormValues } from './contact-validation';
import { LifecycleCard } from './lifecycle-card';
import { MoreTab } from './more-tab';
import { StatsTab } from './stats-tab';
import { useContactActions } from './use-contact-actions';
import { StackHeader } from '@/components/ui/stack-header';
import {
  contactKey,
  useContact,
  useContactTags,
  useDeleteContact,
  useUpdateContact,
} from './use-contacts';

/** The fields the form changed, as the API's update body: an emptied field is sent as null, an untouched one is left out. */
function changesOf(
  contact: ContactResponse,
  values: ContactFormValues,
): Omit<UpdateContactInput, 'rowVersion'> {
  const before = valuesOf(contact);
  const name = values.name.trim();
  const phone = normalisePhone(values.phone);
  const email = values.email.trim();
  return {
    ...(name !== before.name ? { name: name || null } : {}),
    ...(phone !== before.phone ? { phone: phone || null } : {}),
    ...(email !== before.email ? { email: email || null } : {}),
  };
}

/**
 * One contact (WD-CON-007): who they are, how to reach them (phone and email open the dialler and the mail app), where they
 * stand, their tags and custom fields. People who may update contacts can edit the name, phone and email in the same form that
 * creates one, and add or remove tags. A save made on a stale copy is refused by the API; the screen reloads the contact and says so.
 */
export function ContactDetailScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string | string[]; edit?: string }>();
  const id = (Array.isArray(params.id) ? params.id[0] : params.id) ?? '';
  const session = useSession();
  const canRead = can(session.data, 'record.contacts.read');
  const canUpdate = can(session.data, 'record.contacts.update');
  const contact = useContact(id, canRead);
  const tags = useContactTags(id, canRead);
  const update = useUpdateContact(id);
  const remove = useDeleteContact(id);
  const canDelete = can(session.data, 'record.contacts.delete');
  // The WhatsApp summary is counted from the contact's conversations, so it needs the same permission as the inbox.
  const canStats = can(session.data, 'inbox.conversation.read');
  const [tab, setTab] = useState<'about' | 'activity' | 'stats' | 'files'>('activity');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [editing, setEditing] = useState(params.edit === '1');
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<ReturnType<typeof describeContactFailure> | null>(null);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/contacts'));
  const stopEditing = () => {
    setEditing(false);
    setFailure(null);
    setNotice(null);
  };

  const data = contact.data;
  const actions = useContactActions(data ?? null, setNotice);
  const sessionReady = session.data !== undefined;

  const confirmDelete = () => {
    setRemoveError(null);
    remove.mutate(undefined, {
      onSuccess: () => {
        setConfirmingDelete(false);
        router.replace('/contacts');
      },
      onError: (error) => {
        setConfirmingDelete(false);
        setRemoveError(messageForError(error, t));
      },
    });
  };

  let body;
  if (!sessionReady) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (!canRead) {
    body = (
      <EmptyState
        icon="lock-closed-outline"
        title={t('contacts.denied.title')}
        hint={t('contacts.denied.hint')}
      />
    );
  } else if (!data) {
    const missing = isApiError(contact.error) && contact.error.code === ERROR_CODES.NOT_FOUND;
    body = contact.isPending ? (
      <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />
    ) : (
      <View style={styles.pad}>
        <Card>
          <Text danger accessibilityRole="alert">
            {missing ? t('contacts.detail.notFound') : messageForError(contact.error, t)}
          </Text>
          {missing ? null : (
            <Button
              variant="secondary"
              label={t('common.retry')}
              onPress={() => void contact.refetch()}
            />
          )}
        </Card>
      </View>
    );
  } else if (editing) {
    body = (
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {notice ? <Banner tone="warning" message={notice} /> : null}
          {/* Keyed by the version, so a reload after a conflict shows the other person's values. */}
          <ContactForm
            key={data.rowVersion}
            initial={valuesOf(data)}
            submitLabel={t('contacts.edit.save')}
            pending={update.isPending}
            banner={failure?.banner}
            serverErrors={failure?.fields}
            onCancel={stopEditing}
            onSubmit={(values) => {
              setFailure(null);
              setNotice(null);
              const changes = changesOf(data, values);
              if (Object.keys(changes).length === 0) {
                stopEditing();
                return;
              }
              update.mutate(
                { ...changes, rowVersion: data.rowVersion },
                {
                  onSuccess: stopEditing,
                  onError: (error) => {
                    const described = describeContactFailure(error, t);
                    if (described.conflict) {
                      setNotice(t('contacts.edit.conflict'));
                      void queryClient.invalidateQueries({ queryKey: contactKey(id) });
                    } else {
                      setFailure(described);
                    }
                  },
                },
              );
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  } else {
    const name = displayName(data, t);
    const line = contactLine(data);
    body = (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ContactHero name={name} line={line && line !== name ? line : null} style={styles.hero}>
          <LifecycleCard contact={data} />
        </ContactHero>

        {notice ? <Banner tone="warning" message={notice} /> : null}
        {removeError ? <Banner tone="danger" message={removeError} /> : null}

        <SegmentedControl
          label={t('contacts.detail.tabsLabel')}
          fit="content"
          options={[
            { value: 'activity', label: t('contacts.detail.tabs.activity') },
            { value: 'about', label: t('contacts.detail.tabs.about') },
            ...(canStats
              ? [{ value: 'stats' as const, label: t('contacts.detail.tabs.stats') }]
              : []),
            { value: 'files', label: t('contacts.detail.tabs.files') },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'activity' ? (
          <ActivitiesTab contactId={data.id} canUpdate={canUpdate} actions={actions} />
        ) : null}
        {tab === 'about' ? <AboutTab contact={data} tags={tags.data ?? []} /> : null}
        {tab === 'stats' && canStats ? <StatsTab contactId={data.id} /> : null}
        {tab === 'files' ? <MoreTab contact={data} canUpdate={canUpdate} /> : null}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader
        title={editing ? t('contacts.edit.title') : t('contacts.detail.title')}
        onBack={editing ? stopEditing : goBack}
        actions={
          data && !editing ? (
            <>
              {canUpdate ? (
                <HeaderIconButton
                  icon="create-outline"
                  label={t('contacts.edit.open')}
                  onPress={() => setEditing(true)}
                />
              ) : null}
              {canDelete ? (
                <HeaderIconButton
                  icon="trash-outline"
                  label={t('contacts.detail.delete.open')}
                  onPress={() => setConfirmingDelete(true)}
                />
              ) : null}
            </>
          ) : null
        }
      />
      {body}
      <ConfirmDialog
        visible={confirmingDelete}
        title={t('contacts.detail.delete.title')}
        message={t('contacts.detail.delete.message', { name: data ? displayName(data, t) : '' })}
        confirmLabel={t('contacts.detail.delete.confirm')}
        cancelLabel={t('contacts.detail.delete.cancel')}
        pending={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
  pad: { padding: spacing.lg },
  loading: { marginTop: spacing.xxl },
  // Cancels the ScrollView's padding so the band reaches both edges, flush under the header.
  hero: { marginHorizontal: -spacing.lg, marginTop: -spacing.lg },
});
