import type { InboxRewriteAction } from '@crm/contracts';
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
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { filterLanguages, REWRITE_ACTIONS } from './ai-rewrite';

const ICONS: Record<InboxRewriteAction, IconName> = {
  condense: 'contract-outline',
  fix: 'checkmark-done-outline',
  positive: 'happy-outline',
  translate: 'language-outline',
};

interface Props {
  visible: boolean;
  /** A rewrite is on its way: the choices wait. */
  busy: boolean;
  /** Why the last rewrite failed. */
  error: string | null;
  /** The person chose what to do with the draft; `language` (English name) only for a translation. */
  onChoose: (action: InboxRewriteAction, language?: string) => void;
  onClose: () => void;
}

/**
 * The window behind the sparkle button of the message box, "Smart AI Assistant" as in the Geta app: condense the draft, fix its
 * grammar, make it more positive, or translate it (a second page lists the languages). Choosing runs the rewrite on the whole draft
 * and the parent puts the result into the box; nothing is sent.
 */
export function AiAssistantSheet(props: Props) {
  return (
    <Modal transparent visible={props.visible} animationType="fade" onRequestClose={props.onClose}>
      {/* Only mounted while open, so it always starts on the list of actions. */}
      <SheetBody {...props} />
    </Modal>
  );
}

function SheetBody({ busy, error, onChoose, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<'actions' | 'languages'>('actions');
  const [query, setQuery] = useState('');
  const languages = filterLanguages(query);

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      // A modal window is not resized for the keyboard on Android, so the sheet lifts itself (padding on both platforms).
      behavior="padding"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('inbox.sheet.close')}
        onPress={busy ? undefined : onClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
      />
      <View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            marginBottom: insets.bottom + spacing.lg,
          },
        ]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          {page === 'languages' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              disabled={busy}
              onPress={() => {
                setPage('actions');
                setQuery('');
              }}
              style={styles.iconButton}
            >
              <Icon name="chevron-back" size={24} />
            </Pressable>
          ) : null}
          <Text
            variant="heading"
            accessibilityRole="header"
            style={[styles.title, page === 'actions' && styles.titleFirst]}
          >
            {page === 'actions' ? t('inbox.ai.title') : t('inbox.ai.selectLanguage')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('inbox.sheet.close')}
            disabled={busy}
            onPress={onClose}
            style={styles.iconButton}
          >
            <Icon name="close" size={24} />
          </Pressable>
        </View>
        {error ? (
          <View style={styles.pad}>
            <Banner tone="danger" message={error} />
          </View>
        ) : null}
        {busy ? (
          <View style={styles.working} accessibilityLiveRegion="polite">
            <ActivityIndicator accessibilityLabel={t('inbox.ai.working')} />
            <Text muted>{t('inbox.ai.working')}</Text>
          </View>
        ) : page === 'actions' ? (
          REWRITE_ACTIONS.map((action) => (
            <Pressable
              key={action}
              accessibilityRole="button"
              accessibilityLabel={`${t(`inbox.ai.${action}`)}, ${t(`inbox.ai.${action}Hint`)}`}
              onPress={() => (action === 'translate' ? setPage('languages') : onChoose(action))}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <Icon name={ICONS[action]} size={24} />
              <View style={styles.rowText}>
                <Text variant="label">{t(`inbox.ai.${action}`)}</Text>
                <Text variant="caption" muted>
                  {t(`inbox.ai.${action}Hint`)}
                </Text>
              </View>
              {action === 'translate' ? (
                <Icon name="chevron-forward" size={20} color="textMuted" />
              ) : null}
            </Pressable>
          ))
        ) : (
          <View style={styles.languages}>
            <View style={styles.pad}>
              <TextField
                label={t('inbox.ai.searchLanguages')}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                returnKeyType="search"
              />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              {languages.length === 0 ? (
                <Text muted style={styles.pad}>
                  {t('inbox.ai.noLanguage')}
                </Text>
              ) : (
                languages.map((language) => (
                  <Pressable
                    key={language}
                    accessibilityRole="button"
                    accessibilityLabel={language}
                    onPress={() => onChoose('translate', language)}
                    style={[styles.row, { borderBottomColor: colors.border }]}
                  >
                    <Text style={styles.rowText}>{language}</Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  sheet: {
    maxHeight: '80%',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1 },
  titleFirst: { paddingStart: spacing.lg },
  iconButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pad: { padding: spacing.md },
  working: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  languages: { flexShrink: 1 },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
});
