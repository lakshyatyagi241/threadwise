import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { HelpBlocks } from './help-blocks';
import { findDoc, textOf } from './help-data';

/**
 * One Help guide (route /help/[id]): its title and summary, then the body from the web Help center. A guide with no translation
 * in the app's language is shown in English and says so. An address that is not a guide says so instead of showing a blank page.
 */
export function HelpArticleScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const doc = findDoc(id);
  const shown = doc ? textOf(doc, i18n.language) : null;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/help'));

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={shown?.text.title ?? t('menu.helpCenter')} onBack={back} />
      <ScrollView contentContainerStyle={styles.content}>
        {shown ? (
          <>
            <Text variant="title" accessibilityRole="header">
              {shown.text.title}
            </Text>
            <Text muted>{shown.text.summary}</Text>
            {shown.fallback ? <Banner tone="info" message={t('help.fallback')} /> : null}
            <HelpBlocks blocks={shown.text.blocks} />
          </>
        ) : (
          <Banner tone="warning" message={t('help.notFound')} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
});
