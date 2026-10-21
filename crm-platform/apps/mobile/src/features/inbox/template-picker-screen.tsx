import type { InboxTemplateOption } from '@crm/contracts';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { SearchField } from '@/components/ui/search-field';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { SEARCH_DEBOUNCE_MS, useDebounced } from '@/lib/hooks/use-debounced';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { clearTemplateDraft, startTemplateDraft } from './template-draft';
import { categoryWord } from './template-model';
import { useInboxTemplates } from './use-inbox';

/**
 * Page 1 of sending a template (route /template-picker): the approved templates of the number this conversation runs on, searchable, one
 * per row with its category. Pressing one that can be sent opens "Set variables". One the app cannot send yet stays in the list, greyed,
 * with the reason, so it is not a mystery why a template known from the library is missing.
 */
export function TemplatePickerScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const conversationId = (Array.isArray(params.id) ? params.id[0] : params.id) ?? '';
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim(), SEARCH_DEBOUNCE_MS);
  const list = useInboxTemplates(conversationId, q, conversationId !== '');
  // Coming back to the list from "Set variables" (the arrow, the phone's Back, a swipe) ends the draft: what was typed is dropped.
  useFocusEffect(
    useCallback(() => {
      clearTemplateDraft();
    }, []),
  );

  const pick = (template: InboxTemplateOption) => {
    if (!template.sendable) return;
    startTemplateDraft(conversationId, template);
    // `navigate` goes to the page already open instead of stacking a second one when a row is pressed twice.
    router.navigate({ pathname: '/template-variables', params: { id: conversationId } });
  };

  const rows = list.data?.data ?? [];
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <StackHeader title={t('inbox.template.pickTitle')} onBack={() => router.back()} />
      <View style={styles.search}>
        <SearchField
          label={t('inbox.template.search')}
          placeholder={t('inbox.template.searchPlaceholder')}
          value={typed}
          onChangeText={setTyped}
          clearLabel={t('common.clear')}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>
      {conversationId === '' ? (
        <Text muted style={styles.pad}>
          {t('inbox.errors.notFound')}
        </Text>
      ) : list.isPending ? (
        <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.pad} />
      ) : list.error ? (
        <View style={styles.pad}>
          <Banner tone="danger" message={messageForError(list.error, t)} />
          <Button variant="link" label={t('common.retry')} onPress={() => void list.refetch()} />
        </View>
      ) : rows.length === 0 ? (
        <Text muted style={styles.pad}>
          {q ? t('inbox.template.emptySearch') : t('inbox.template.empty')}
        </Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(template) => template.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <TemplateRow template={item} onPress={() => pick(item)} />}
          ListFooterComponent={
            list.data?.hasMore ? (
              <Text variant="caption" muted style={styles.pad}>
                {t('inbox.template.more')}
              </Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

function TemplateRow({
  template,
  onPress,
}: {
  template: InboxTemplateOption;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const reason = template.reason ? t(`inbox.template.reason.${template.reason}`) : null;
  return (
    <Pressable
      accessibilityRole="button"
      // The reason is part of the name read out, not a hint (hints are often switched off): a dimmed row says why.
      accessibilityLabel={[template.name, categoryWord(template.category), reason]
        .filter(Boolean)
        .join(', ')}
      accessibilityState={{ disabled: !template.sendable }}
      disabled={!template.sendable}
      onPress={onPress}
      style={[styles.row, { borderBottomColor: colors.border }, !template.sendable && styles.faded]}
    >
      <View style={styles.rowText}>
        <Text variant="label">{template.name}</Text>
        <Text variant="caption" muted>
          {categoryWord(template.category)}
        </Text>
        {reason ? (
          <Text variant="caption" danger>
            {reason}
          </Text>
        ) : null}
      </View>
      {template.sendable ? <Icon name="chevron-forward" size={22} color="textMuted" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  search: { padding: spacing.lg },
  pad: { padding: spacing.lg },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: spacing.xs },
  faded: { opacity: 0.55 },
});
