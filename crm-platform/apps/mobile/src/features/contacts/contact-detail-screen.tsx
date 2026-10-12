import { ERROR_CODES, type ContactResponse, type UpdateContactInput } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
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
import { Avatar } from '@/components/ui/avatar';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { HeaderIconButton } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ContactForm, valuesOf } from './contact-form';
import {
  contactLine,
  customValueText,
  displayName,
  formatDate,
  formatMoment,
} from './contact-display';
import { describeContactFailure } from './contact-errors';
import { ContactTags } from './contact-tags';
import { normalisePhone, type ContactFormValues } from './contact-validation';
import { InfoRow } from './info-row';
import { StackHeader } from './stack-header';
import { contactKey, useContact, useContactTags, useUpdateContact } from './use-contacts';

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

function subscriptionTone(status: string): BadgeTone {
  if (status === 'subscribed') return 'success';
  if (status === 'unsubscribed') return 'danger';
  return 'neutral';
}

/**
 * One contact (WD-CON-007): who they are, how to reach them (phone and email open the dialler and the mail app), where they
 * stand, their tags and custom fields. People who may update contacts can edit the name, phone and email in the same form that
 * creates one, and add or remove tags. A save made on a stale copy is refused by the API; the screen reloads the contact and says so.
 */
export function ContactDetailScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = (Array.isArray(params.id) ? params.id[0] : params.id) ?? '';
  const session = useSession();
  const canRead = can(session.data, 'record.contacts.read');
  const canUpdate = can(session.data, 'record.contacts.update');
  const contact = useContact(id, canRead);
  const tags = useContactTags(id, canRead);
  const update = useUpdateContact(id);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<ReturnType<typeof describeContactFailure> | null>(null);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/contacts'));
  const stopEditing = () => {
    setEditing(false);
    setFailure(null);
    setNotice(null);
  };

  const data = contact.data;
  const sessionReady = session.data !== undefined;

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
    const locale = i18n.language;
    const custom = Object.entries(data.customFields)
      .map(
        ([key, value]) =>
          [key, customValueText(value, t('contacts.yes'), t('contacts.no'))] as const,
      )
      .filter((entry): entry is readonly [string, string] => entry[1] !== null);
    const whatsapp = data.whatsappSubscriptionStatus;
    body = (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Avatar name={name} size={72} />
          <Text variant="title" accessibilityRole="header" style={styles.center}>
            {name}
          </Text>
          {line && line !== name ? (
            <Text muted style={styles.center}>
              {line}
            </Text>
          ) : null}
        </View>

        {data.phone || data.email ? (
          <Card>
            <InfoRow
              label={t('contacts.detail.phone')}
              value={data.phone}
              linkLabel={t('contacts.detail.call', { phone: data.phone })}
              onPress={() => void Linking.openURL(`tel:${data.phone}`)}
            />
            <InfoRow
              label={t('contacts.detail.email')}
              value={data.email}
              linkLabel={t('contacts.detail.mail', { email: data.email })}
              onPress={() => void Linking.openURL(`mailto:${data.email}`)}
            />
          </Card>
        ) : null}

        <Card>
          <InfoRow
            label={t('contacts.detail.stage')}
            value={
              data.lifecycleStage
                ? t(`contacts.stage.${data.lifecycleStage}`, { defaultValue: data.lifecycleStage })
                : null
            }
          />
          <InfoRow label={t('contacts.detail.status')} value={data.status} />
          <InfoRow label={t('contacts.detail.source')} value={data.source} />
          <InfoRow label={t('contacts.detail.whatsapp')}>
            {whatsapp ? (
              <Badge
                tone={subscriptionTone(whatsapp)}
                label={t(`contacts.subscription.${whatsapp}`, { defaultValue: whatsapp })}
              />
            ) : null}
          </InfoRow>
          <InfoRow label={t('contacts.detail.marketing')}>
            <Badge
              tone={data.isUnsubscribed ? 'danger' : 'success'}
              label={
                data.isUnsubscribed ? t('contacts.detail.optedOut') : t('contacts.detail.optedIn')
              }
            />
          </InfoRow>
        </Card>

        <Card>
          <InfoRow
            label={t('contacts.detail.lastActivity')}
            value={formatMoment(data.lastActivityAt, locale) ?? t('contacts.detail.noActivity')}
          />
          <InfoRow
            label={t('contacts.detail.created')}
            value={formatDate(data.createdAt, locale)}
          />
        </Card>

        <ContactTags contactId={data.id} tags={tags.data ?? []} editable={canUpdate} />

        {custom.length > 0 ? (
          <Card>
            <Text variant="subheading">{t('contacts.detail.customFields')}</Text>
            {custom.map(([key, value]) => (
              <InfoRow key={key} label={key} value={value} />
            ))}
          </Card>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader
        title={editing ? t('contacts.edit.title') : t('contacts.detail.title')}
        onBack={editing ? stopEditing : goBack}
        actions={
          canUpdate && data && !editing ? (
            <HeaderIconButton
              icon="create-outline"
              label={t('contacts.edit.open')}
              onPress={() => setEditing(true)}
            />
          ) : null
        }
      />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
  pad: { padding: spacing.lg },
  loading: { marginTop: spacing.xxl },
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  center: { textAlign: 'center' },
});
