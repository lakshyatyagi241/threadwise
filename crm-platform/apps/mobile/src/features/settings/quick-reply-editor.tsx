import {
  CHANNEL_KINDS,
  SAVED_REPLY_BODY_MAX,
  SAVED_REPLY_CATEGORY_MAX,
  SAVED_REPLY_SHORTCUT_MAX,
  SAVED_REPLY_TITLE_MAX,
  SAVED_REPLY_VARIABLES,
  SAVED_REPLY_VARIABLE_GROUPS,
  normalizeShortcut,
  type ChannelKind,
  type SavedReplyScope,
} from '@crm/contracts';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
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
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField, type TextFieldHandle } from '@/components/ui/text-field';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import {
  draftProblems,
  insertAtSelection,
  previewOf,
  type DraftField,
  type DraftProblem,
  type QuickReplyDraft,
} from './quick-reply-draft';

interface Props {
  mode: 'create' | 'edit';
  initial: QuickReplyDraft;
  pending: boolean;
  /** A message about the whole form (a failed save), shown above the fields. */
  banner?: string | null;
  /** Something to look at before saving again (someone else changed the reply). */
  notice?: string | null;
  /** What the server refused, by field, in the person's language. */
  serverErrors?: Partial<Record<DraftField, string>>;
  onBack: () => void;
  /** Called with a draft that passed the checks. */
  onSubmit: (draft: QuickReplyDraft) => void;
}

/**
 * The form to add a saved reply and to edit one (the web's own form, laid out for a phone): shortcut, title, text with the variables
 * that insert at the cursor and a live preview with sample customer data, category, language, the channels it is meant for, and who
 * can use it. Who can use it is chosen once: a reply cannot change between shared and personal after it is saved. The checks are the
 * contract's; everything else is the server's answer, shown under the field or above the form.
 */
export function QuickReplyEditor({
  mode,
  initial,
  pending,
  banner,
  notice,
  serverErrors,
  onBack,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [problems, setProblems] = useState<Partial<Record<DraftField, string>>>({});
  const [selection, setSelection] = useState({
    start: initial.body.length,
    end: initial.body.length,
  });
  const titleInput = useRef<TextFieldHandle>(null);
  const bodyInput = useRef<TextFieldHandle>(null);
  const set = <K extends keyof QuickReplyDraft>(key: K, value: QuickReplyDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const stored = normalizeShortcut(draft.shortcut);
  const preview = previewOf(draft.body);
  const fieldError = (field: DraftField) => problems[field] ?? serverErrors?.[field];

  const submit = () => {
    const found = draftProblems(draft);
    const shown: Partial<Record<DraftField, string>> = {};
    for (const [field, problem] of Object.entries(found) as [DraftField, DraftProblem][]) {
      shown[field] = t(`settings.quickReplies.form.${problem}`, {
        max: field === 'title' ? SAVED_REPLY_TITLE_MAX : SAVED_REPLY_BODY_MAX,
      });
    }
    setProblems(shown);
    if (Object.keys(shown).length === 0) onSubmit(draft);
  };

  const insertVariable = (key: string) => {
    const next = insertAtSelection(draft.body, selection, `{{${key}}}`);
    set('body', next.value);
    setSelection({ start: next.caret, end: next.caret });
    bodyInput.current?.focus();
  };

  const toggleKind = (kind: ChannelKind) =>
    set(
      'channelKinds',
      draft.channelKinds.includes(kind)
        ? draft.channelKinds.filter((k) => k !== kind)
        : [...draft.channelKinds, kind],
    );

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StackHeader
        title={t(
          mode === 'create'
            ? 'settings.quickReplies.form.titleNew'
            : 'settings.quickReplies.form.titleEdit',
        )}
        onBack={onBack}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {banner ? <Banner tone="danger" message={banner} /> : null}
        {notice ? <Banner tone="warning" message={notice} /> : null}

        <TextField
          label={t('settings.quickReplies.form.shortcut')}
          hint={
            stored
              ? t('settings.quickReplies.form.shortcutStored', { shortcut: stored })
              : t('settings.quickReplies.form.shortcutHint', { max: SAVED_REPLY_SHORTCUT_MAX })
          }
          value={draft.shortcut}
          onChangeText={(v) => set('shortcut', v)}
          error={fieldError('shortcut')}
          placeholder={t('settings.quickReplies.form.shortcutPlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => titleInput.current?.focus()}
        />
        <TextField
          label={t('settings.quickReplies.form.title')}
          value={draft.title}
          onChangeText={(v) => set('title', v)}
          error={fieldError('title')}
          inputRef={titleInput}
          placeholder={t('settings.quickReplies.form.titlePlaceholder')}
          maxLength={SAVED_REPLY_TITLE_MAX + 20}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => bodyInput.current?.focus()}
        />
        <TextField
          label={t('settings.quickReplies.form.body')}
          hint={`${t('settings.quickReplies.form.bodyHint')} ${t('settings.quickReplies.form.count', { n: draft.body.length, max: SAVED_REPLY_BODY_MAX })}`}
          value={draft.body}
          onChangeText={(v) => set('body', v)}
          onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
          selection={selection}
          error={fieldError('body')}
          inputRef={bodyInput}
          placeholder={t('settings.quickReplies.form.bodyPlaceholder', {
            example: '{{first_name}}',
          })}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
        />

        <Card>
          <Text variant="label">{t('settings.quickReplies.form.variables')}</Text>
          <Text variant="caption" muted>
            {t('settings.quickReplies.form.variablesHint')}
          </Text>
          {SAVED_REPLY_VARIABLE_GROUPS.map((group) => (
            <View key={group} style={styles.group}>
              <Text variant="caption" muted>
                {t(`settings.quickReplies.variableGroup.${group}`)}
              </Text>
              <View style={styles.chips}>
                {SAVED_REPLY_VARIABLES.filter((v) => v.group === group).map((v) => (
                  <Chip
                    key={v.key}
                    // A variable the contract adds before this build has words for it is shown by its name.
                    label={t(`settings.quickReplies.variable.${v.key}`, { defaultValue: v.key })}
                    hint={`{{${v.key}}}`}
                    onPress={() => insertVariable(v.key)}
                  />
                ))}
              </View>
            </View>
          ))}
        </Card>

        <Card>
          <Text variant="label">{t('settings.quickReplies.form.preview')}</Text>
          <Text variant="caption" muted>
            {t('settings.quickReplies.form.previewHint')}
          </Text>
          <Text testID="quick-reply-preview">
            {draft.body.trim() === '' ? t('settings.quickReplies.form.previewEmpty') : preview.text}
          </Text>
          {preview.issues.length > 0 ? (
            <Text variant="caption" muted>
              {t('settings.quickReplies.form.previewIssues', {
                list: preview.issues.map((i) => i.token).join(', '),
              })}
            </Text>
          ) : null}
        </Card>

        <TextField
          label={t('settings.quickReplies.form.category')}
          value={draft.category}
          onChangeText={(v) => set('category', v)}
          placeholder={t('settings.quickReplies.form.categoryPlaceholder')}
          maxLength={SAVED_REPLY_CATEGORY_MAX}
          returnKeyType="next"
        />
        <TextField
          label={t('settings.quickReplies.form.language')}
          hint={t('settings.quickReplies.form.languageHint')}
          value={draft.language}
          onChangeText={(v) => set('language', v)}
          error={fieldError('language')}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={16}
        />

        <View style={styles.group}>
          <Text variant="label">{t('settings.quickReplies.form.channels')}</Text>
          <Text variant="caption" muted>
            {t('settings.quickReplies.form.channelsHint')}
          </Text>
          <View style={styles.chips}>
            {CHANNEL_KINDS.map((kind) => (
              <Chip
                key={kind}
                label={t(`settings.quickReplies.channelKind.${kind}`)}
                selected={draft.channelKinds.includes(kind)}
                onPress={() => toggleKind(kind)}
              />
            ))}
          </View>
        </View>

        <View style={styles.group}>
          <Text variant="label">{t('settings.quickReplies.form.scope')}</Text>
          {mode === 'create' ? (
            <SegmentedControl<SavedReplyScope>
              label={t('settings.quickReplies.form.scope')}
              value={draft.scope}
              onChange={(v) => set('scope', v)}
              options={[
                { value: 'shared', label: t('settings.quickReplies.form.scopeOption.shared') },
                { value: 'mine', label: t('settings.quickReplies.form.scopeOption.mine') },
              ]}
            />
          ) : (
            <>
              <Text>{t(`settings.quickReplies.form.scopeOption.${draft.scope}`)}</Text>
              <Text variant="caption" muted>
                {t('settings.quickReplies.form.scopeLocked')}
              </Text>
            </>
          )}
        </View>

        <Button
          label={t('settings.quickReplies.form.save')}
          testID="quick-reply-save"
          loading={pending}
          onPress={submit}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** A small tappable pill: a variable to insert, or a channel to switch on or off (`selected` makes it a checkbox). */
function Chip({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint?: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const isToggle = selected !== undefined;
  return (
    <Pressable
      accessibilityRole={isToggle ? 'checkbox' : 'button'}
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={isToggle ? { checked: selected } : undefined}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primarySoft : colors.surface,
          borderColor: selected ? colors.primary : colors.borderStrong,
        },
      ]}
    >
      <Text variant="caption" color={selected ? 'primary' : 'text'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  group: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
