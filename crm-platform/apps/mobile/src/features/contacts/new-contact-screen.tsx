import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { EmptyState } from '@/components/ui/empty-state';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ContactForm, EMPTY_CONTACT } from './contact-form';
import { describeContactFailure, type ContactFailure } from './contact-errors';
import { normalisePhone } from './contact-validation';
import { NewContactProperties } from './new-contact-properties';
import { EMPTY_DRAFT, type Draft } from './property-values';
import {
  applicableFields,
  collectCustomFields,
  requiredFieldsOf,
  type Drafts,
} from './required-properties';
import { StackHeader } from '@/components/ui/stack-header';
import { useCreateContact } from './use-contacts';
import { useContactFieldDependencies, useContactFields } from './use-properties';

type Problems = Readonly<Record<string, string | undefined>>;

/**
 * Add a contact (WD-CON-001): name, phone, email, and the properties the workspace requires (the API refuses a contact without
 * them). When the phone or email already belongs to a contact, the API answers with that contact and the screen simply opens it,
 * so nobody ends up with a duplicate.
 *
 * The required properties come from the workspace's own definitions, shown only while their conditions hold. When the person may
 * not read the definitions, or they could not be loaded, the form is sent as it is and the API's answer names what is missing:
 * those properties then appear with the message under them.
 */
export function NewContactScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const session = useSession();
  const create = useCreateContact();
  const [failure, setFailure] = useState<ContactFailure | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [problems, setProblems] = useState<Problems>({});
  // Properties the API named as missing: shown even when the app's own reading of the conditions left them out.
  const [named, setNamed] = useState<readonly string[]>([]);

  const canReadFields = can(session.data, 'record.contact-properties.read');
  const fields = useContactFields(canReadFields);
  const dependencies = useContactFieldDependencies(canReadFields);
  const ready = fields.isSuccess && dependencies.isSuccess;
  const loading =
    session.isPending || (canReadFields && !ready && !fields.isError && !dependencies.isError);

  const required = useMemo(() => requiredFieldsOf(fields.data ?? []), [fields.data]);
  const asked = useMemo(() => {
    const applicable = ready
      ? applicableFields(required, dependencies.data, fields.data, drafts)
      : [];
    return required.filter((f) => applicable.includes(f) || named.includes(f.key));
  }, [ready, required, dependencies.data, fields.data, drafts, named]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/contacts'));
  const denied = session.data !== undefined && !can(session.data, 'record.contacts.create');

  const change = (key: string, patch: Partial<Draft>) => {
    setDrafts((d) => ({ ...d, [key]: { ...(d[key] ?? EMPTY_DRAFT), ...patch } }));
    setProblems((p) => ({ ...p, [key]: undefined }));
  };

  /** Checks the properties on screen; false keeps the form from being sent, with the reason under each one. */
  const check = (): boolean => {
    const collected = collectCustomFields(asked, drafts);
    if (collected.ok) return true;
    const messages: Record<string, string> = {};
    for (const [key, problem] of Object.entries(collected.problems)) {
      const label = asked.find((f) => f.key === key)?.label ?? key;
      messages[key] =
        problem.error === 'unsupported'
          ? t('contacts.new.unsupported', { label })
          : t(`contactProps.error.${problem.error}`, problem.params);
    }
    setProblems(messages);
    return false;
  };

  const onFailure = (error: unknown) => {
    const described = describeContactFailure(error, t);
    if (described.missing.length === 0) {
      setFailure(described);
      return;
    }
    const known = required.filter((f) => described.missing.includes(f.key));
    setNamed((keys) => [...new Set([...keys, ...known.map((f) => f.key)])]);
    setProblems((p) => ({
      ...p,
      ...Object.fromEntries(
        known.map((f) => [f.key, t('contactProps.error.required', { label: f.label })]),
      ),
    }));
    // The sentence about the whole form stays only when the API named something this form has no input for.
    const covered = known.length === described.missing.length;
    setFailure({ ...described, banner: covered ? null : described.banner });
  };

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
              extra={
                loading ? (
                  <ActivityIndicator accessibilityLabel={t('common.loading')} />
                ) : (
                  <NewContactProperties
                    fields={asked}
                    drafts={drafts}
                    problems={problems}
                    onChange={change}
                  />
                )
              }
              beforeSubmit={check}
              onSubmit={(values) => {
                setFailure(null);
                const name = values.name.trim();
                const phone = normalisePhone(values.phone);
                const email = values.email.trim();
                const collected = collectCustomFields(asked, drafts);
                const customFields = collected.ok ? collected.value : {};
                create.mutate(
                  {
                    ...(name ? { name } : {}),
                    ...(phone ? { phone } : {}),
                    ...(email ? { email } : {}),
                    ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
                  },
                  {
                    onSuccess: (contact) =>
                      router.replace({ pathname: '/contact/[id]', params: { id: contact.id } }),
                    onError: onFailure,
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
