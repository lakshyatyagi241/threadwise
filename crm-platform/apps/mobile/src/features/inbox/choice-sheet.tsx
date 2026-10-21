import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

export interface ChoiceOption {
  value: string;
  label: string;
  /** A second, muted line under the label. */
  hint?: string;
}

export interface ChoiceGroup {
  key: string;
  /** A heading over the group when the sheet has more than one. */
  title?: string;
  /** Several options may be ticked (check boxes); the group's value is the ticked values joined with a comma. */
  multiple?: boolean;
  options: readonly ChoiceOption[];
}

interface Props {
  visible: boolean;
  title: string;
  groups: readonly ChoiceGroup[];
  /** What is chosen in each group (by group key) when the sheet opens: `''` is a real choice ("nobody"). */
  initial: Readonly<Record<string, string>>;
  /** Names the search box; the box shows only when the groups hold more than a screenful of options. */
  searchLabel?: string;
  /** The options are still being asked for, or could not be. */
  loading?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  saving: boolean;
  /** Why the last save failed. */
  error: string | null;
  /** When given, Save also waits for this to hold (a bulk label needs a label, not only a changed mode). */
  isValid?: (picked: Readonly<Record<string, string>>) => boolean;
  /** Called with the choice of every group, only when something was changed. */
  onSave: (picked: Record<string, string>) => void;
  onClose: () => void;
}

/** The ticked values of a multiple group, as a list (a value never holds a comma: they are ids). */
const listOf = (joined: string | undefined): string[] => (joined ? joined.split(',') : []);
/** The same ticks in a fixed order, so two ways of ticking the same options are the same choice. */
const canonical = (joined: string | undefined): string => listOf(joined).sort().join(',');

/** More options than this get a search box. */
const SEARCH_FROM = 8;

/**
 * The bottom sheet behind "Change status", "Change agent", "Set priority" and "Snooze": pick one option in each group, then Save
 * (the same two steps as the reference app). Groups are single choice; a group's heading is shown only when there is more than one.
 */
export function ChoiceSheet(props: Props) {
  return (
    <Modal transparent visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      {/* Only mounted while open, so the choice always starts from what the conversation has now. */}
      <SheetBody {...props} />
    </Modal>
  );
}

function SheetBody({
  title,
  groups,
  initial,
  searchLabel,
  loading,
  loadError,
  onRetry,
  saving,
  error,
  isValid,
  onSave,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<Record<string, string>>({ ...initial });
  const [search, setSearch] = useState('');

  const total = groups.reduce((n, g) => n + g.options.length, 0);
  const needle = search.trim().toLowerCase();
  const showSearch = Boolean(searchLabel) && total > SEARCH_FROM;
  const changed = groups.some((g) =>
    g.multiple
      ? canonical(picked[g.key]) !== canonical(initial[g.key])
      : (picked[g.key] ?? '') !== (initial[g.key] ?? ''),
  );
  const choose = (group: ChoiceGroup, value: string) =>
    setPicked((p) => {
      if (!group.multiple) return { ...p, [group.key]: value };
      const ticked = listOf(p[group.key]);
      return {
        ...p,
        [group.key]: (ticked.includes(value)
          ? ticked.filter((v) => v !== value)
          : [...ticked, value]
        ).join(','),
      };
    });

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      // A sheet is a modal window, which the phone does not resize for the keyboard (Android leaves it under the keys), so the sheet
      // lifts itself: padding on both platforms.
      behavior="padding"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('inbox.sheet.close')}
        onPress={onClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
      />
      <View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
      >
        <View style={styles.header}>
          <Text variant="heading" accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('inbox.sheet.close')}
            onPress={onClose}
            style={styles.close}
          >
            <Icon name="close" size={24} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {error ? <Banner tone="danger" message={error} /> : null}
          {showSearch && searchLabel ? (
            <TextField
              label={searchLabel}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              returnKeyType="search"
            />
          ) : null}
          {loading ? (
            <ActivityIndicator accessibilityLabel={t('common.loading')} />
          ) : loadError ? (
            <View>
              <Banner tone="danger" message={loadError} />
              {onRetry ? (
                <Button variant="link" align="start" label={t('common.retry')} onPress={onRetry} />
              ) : null}
            </View>
          ) : (
            groups.map((group) => {
              const shown = needle
                ? group.options.filter(
                    (o) =>
                      o.label.toLowerCase().includes(needle) ||
                      (o.hint ?? '').toLowerCase().includes(needle),
                  )
                : group.options;
              return (
                <View key={group.key} accessibilityRole={group.multiple ? undefined : 'radiogroup'}>
                  {groups.length > 1 && group.title ? (
                    <Text variant="label" muted>
                      {group.title}
                    </Text>
                  ) : null}
                  {shown.length === 0 ? (
                    <Text muted>{t('inbox.sheet.noMatch')}</Text>
                  ) : (
                    shown.map((option) => {
                      const checked = group.multiple
                        ? listOf(picked[group.key]).includes(option.value)
                        : (picked[group.key] ?? '') === option.value;
                      return (
                        <Pressable
                          key={`${group.key}:${option.value}`}
                          accessibilityRole={group.multiple ? 'checkbox' : 'radio'}
                          accessibilityLabel={
                            option.hint ? `${option.label}, ${option.hint}` : option.label
                          }
                          accessibilityState={{ checked, disabled: saving }}
                          disabled={saving}
                          onPress={() => choose(group, option.value)}
                          style={[styles.row, { borderBottomColor: colors.border }]}
                        >
                          <View style={styles.rowText}>
                            <Text variant={checked ? 'label' : 'body'}>{option.label}</Text>
                            {option.hint ? (
                              <Text variant="caption" muted>
                                {option.hint}
                              </Text>
                            ) : null}
                          </View>
                          <Icon
                            name={
                              group.multiple
                                ? checked
                                  ? 'checkbox'
                                  : 'square-outline'
                                : checked
                                  ? 'radio-button-on'
                                  : 'radio-button-off'
                            }
                            size={22}
                            color={checked ? 'primary' : 'textMuted'}
                          />
                        </Pressable>
                      );
                    })
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
        <View style={styles.footer}>
          <Button
            label={t('inbox.sheet.save')}
            loading={saving}
            disabled={
              !changed ||
              loading === true ||
              Boolean(loadError) ||
              (isValid ? !isValid(picked) : false)
            }
            onPress={() => onSave(picked)}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg },
  title: { flex: 1 },
  close: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: spacing.lg, gap: spacing.md },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
});
