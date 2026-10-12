import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { EmptyState } from '@/components/ui/empty-state';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ContactForm, EMPTY_CONTACT } from './contact-form';
import { describeContactFailure, type ContactFailure } from './contact-errors';
import { normalisePhone } from './contact-validation';
import { StackHeader } from './stack-header';
import { useCreateContact } from './use-contacts';

/**
 * Add a contact (WD-CON-001): name, phone, email. When the phone or email already belongs to a contact, the API answers with that
 * contact and the screen simply opens it, so nobody ends up with a duplicate.
 */
export function NewContactScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const session = useSession();
  const create = useCreateContact();
  const [failure, setFailure] = useState<ContactFailure | null>(null);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/contacts'));
  const denied = session.data !== undefined && !can(session.data, 'record.contacts.create');

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={t('contacts.new.title')} onBack={back} />
      {denied ? (
        <EmptyState
          icon="lock-closed-outline"
          title={t('contacts.denied.createTitle')}
          hint={t('contacts.denied.createHint')}
        />
      ) : (
        <KeyboardAvoidingView style={styles.fill} behavior="padding">
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <ContactForm
              initial={EMPTY_CONTACT}
              submitLabel={t('contacts.new.save')}
              pending={create.isPending}
              banner={failure?.banner}
              serverErrors={failure?.fields}
              onCancel={back}
              onSubmit={(values) => {
                setFailure(null);
                const name = values.name.trim();
                const phone = normalisePhone(values.phone);
                const email = values.email.trim();
                create.mutate(
                  {
                    ...(name ? { name } : {}),
                    ...(phone ? { phone } : {}),
                    ...(email ? { email } : {}),
                  },
                  {
                    onSuccess: (contact) =>
                      router.replace({ pathname: '/contact/[id]', params: { id: contact.id } }),
                    onError: (error) => setFailure(describeContactFailure(error, t)),
                  },
                );
              }}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
});
