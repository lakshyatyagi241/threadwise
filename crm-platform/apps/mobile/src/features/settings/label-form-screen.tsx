import { INBOX_TAG_NAME_MAX } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField, type TextFieldHandle } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { LABEL_COLORS, MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { LabelDot } from './label-dot';
import {
  EMPTY_LABEL,
  draftOfLabel,
  labelProblems,
  toCreateLabel,
  toUpdateLabel,
  type LabelDraft,
  type LabelField,
} from './label-draft';
import { describeLabelFailure, isLabelGone, type LabelFailure } from './label-errors';
import { labelLibraryKey, useCreateLabel, useLabelList, useUpdateLabel } from './use-label-library';

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

/**
 * Add a label, or edit one (`?labelId=`): its name, its colour (a swatch or any hex colour typed in) and an optional description. The
 * label is found in the library list (there is no route for one label), so an edit of a label that was deleted meanwhile says so. An
 * edit carries the version that was read; a label changed by someone else is reloaded with a note to review it and save again.
 */
export function LabelFormScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ labelId?: string | string[] }>();
  const labelId = first(params.labelId);
  const editing = labelId !== '';
  const session = useSession();
  const allowed = can(session.data, 'inbox.tag.manage');

  const library = useLabelList(allowed && editing);
  const create = useCreateLabel();
  const update = useUpdateLabel(labelId);
  const [failure, setFailure] = useState<LabelFailure | null>(null);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/labels'));
  const current = library.data?.data.find((label) => label.id === labelId);
  const header = (
    <StackHeader
      title={t(editing ? 'settings.labels.editTitle' : 'inbox.thread.labels.newLabel')}
      onBack={goBack}
    />
  );

  let body;
  if (session.data === undefined || (allowed && editing && library.isPending)) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (!allowed) {
    body = <EmptyState icon="lock-closed-outline" title={t('settings.labels.noAccess')} />;
  } else if (editing && !current) {
    body = (
      <View style={styles.pad}>
        <Card>
          <Text danger accessibilityRole="alert">
            {library.isError ? messageForError(library.error, t) : t('settings.labels.notFound')}
          </Text>
          {library.isError && !isLabelGone(library.error) ? (
            <Button
              variant="secondary"
              label={t('common.retry')}
              onPress={() => void library.refetch()}
            />
          ) : null}
        </Card>
      </View>
    );
  } else {
    const fail = (error: unknown) => {
      const described = describeLabelFailure(error, t);
      setFailure(described);
      if (described.conflict) void queryClient.invalidateQueries({ queryKey: labelLibraryKey });
    };
    const onSubmit = (draft: LabelDraft) => {
      setFailure(null);
      if (current) {
        update.mutate(toUpdateLabel(draft, current.rowVersion), {
          onSuccess: goBack,
          onError: fail,
        });
      } else {
        create.mutate(toCreateLabel(draft), { onSuccess: goBack, onError: fail });
      }
    };
    return (
      <View style={[styles.fill, { backgroundColor: colors.background }]}>
        <LabelEditor
          key={current?.rowVersion ?? 'new'}
          title={t(editing ? 'settings.labels.editTitle' : 'inbox.thread.labels.newLabel')}
          initial={current ? draftOfLabel(current) : EMPTY_LABEL}
          pending={create.isPending || update.isPending}
          banner={failure && !failure.conflict ? failure.banner : null}
          notice={failure?.conflict ? failure.banner : null}
          serverErrors={failure?.fields}
          onBack={goBack}
          onSubmit={onSubmit}
        />
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      {header}
      {body}
    </View>
  );
}

interface EditorProps {
  title: string;
  initial: LabelDraft;
  pending: boolean;
  banner: string | null;
  notice: string | null;
  serverErrors?: Partial<Record<LabelField, string>>;
  onBack: () => void;
  onSubmit: (draft: LabelDraft) => void;
}

function LabelEditor({
  title,
  initial,
  pending,
  banner,
  notice,
  serverErrors,
  onBack,
  onSubmit,
}: EditorProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [draft, setDraft] = useState(initial);
  const [problems, setProblems] = useState<Partial<Record<LabelField, string>>>({});
  const colorInput = useRef<TextFieldHandle>(null);
  const set = <K extends keyof LabelDraft>(key: K, value: LabelDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const fieldError = (field: LabelField) => problems[field] ?? serverErrors?.[field];

  const submit = () => {
    const found = labelProblems(draft);
    const shown: Partial<Record<LabelField, string>> = {};
    if (found.name) shown.name = t('settings.labels.nameEmpty');
    if (found.color) shown.color = t('settings.labels.colorInvalid');
    setProblems(shown);
    if (Object.keys(shown).length === 0) onSubmit(draft);
  };

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StackHeader title={title} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {banner ? <Banner tone="danger" message={banner} /> : null}
        {notice ? <Banner tone="warning" message={notice} /> : null}
        <TextField
          label={t('settings.labels.name')}
          value={draft.name}
          onChangeText={(v) => set('name', v)}
          error={fieldError('name')}
          maxLength={INBOX_TAG_NAME_MAX}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => colorInput.current?.focus()}
        />
        <View style={styles.group}>
          <Text variant="label">{t('settings.labels.color')}</Text>
          <View style={styles.swatches}>
            {LABEL_COLORS.map((hex) => {
              const selected = draft.color.trim().toLowerCase() === hex.toLowerCase();
              return (
                <Pressable
                  key={hex}
                  accessibilityRole="radio"
                  accessibilityLabel={hex}
                  accessibilityState={{ selected }}
                  onPress={() => set('color', hex)}
                  style={[
                    styles.swatch,
                    { borderColor: selected ? colors.primary : colors.border },
                  ]}
                >
                  <LabelDot color={hex} size={28} />
                </Pressable>
              );
            })}
          </View>
          <View style={styles.preview}>
            <LabelDot color={draft.color} size={28} />
            <View style={styles.previewField}>
              <TextField
                label={t('settings.labels.color')}
                value={draft.color}
                onChangeText={(v) => set('color', v)}
                error={fieldError('color')}
                inputRef={colorInput}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={16}
                returnKeyType="next"
              />
            </View>
          </View>
        </View>
        <TextField
          label={t('settings.labels.description')}
          value={draft.description}
          onChangeText={(v) => set('description', v)}
          maxLength={255}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
        <Button
          label={t('settings.labels.save')}
          testID="label-save"
          loading={pending}
          onPress={submit}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: spacing.lg },
  loading: { marginTop: spacing.xxl },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  group: { gap: spacing.sm },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: MIN_TOUCH_TARGET / 2,
    borderWidth: 2,
  },
  preview: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  previewField: { flex: 1 },
});
