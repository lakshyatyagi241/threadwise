import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { BrandMark } from '@/components/ui/brand-mark';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { HeaderIconButton } from '@/components/ui/screen-header';
import { SearchField } from '@/components/ui/search-field';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { BRAND_NAME } from '@/config/brand';
import { env } from '@/config/env';
import { resolveLegalUrl } from '@/lib/links/legal-url';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { CATEGORY_TITLE } from './help-categories';
import { HelpDrawer } from './help-drawer';
import { docsIn, HELP_CATEGORIES, searchDocs, textOf, type HelpDoc } from './help-data';

/** The web app's full Help center, or null when the app does not know the web address. It opens in the browser. */
function webHelpUrl(): string | null {
  return resolveLegalUrl('/help', env.webUrl, { allowHttp: env.variant === 'development' });
}

/**
 * Help (route /help, from the menu), laid out like the Geta app's Help screen: a bar with the product and two buttons (the guide
 * menu, search), the title with a short welcome and three tips, then one card per group of guides listing its guides, each of
 * which opens as its own screen. The guides are the web Help center's own, kept inside the app because the web Help center asks
 * for a sign-in the app cannot hand over (the app's tokens never go in an address). Under the cards, when the web address is
 * known, one button opens the full Help center in the browser.
 */
export function HelpScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState(false);
  const webUrl = webHelpUrl();
  const typed = query.trim();
  const results = searching && typed ? searchDocs(typed, i18n.language) : null;

  const open = (id: string) => router.push({ pathname: '/help/[id]', params: { id } });
  const toggleSearch = () => {
    setSearching((on) => !on);
    setQuery('');
  };
  const row = (doc: HelpDoc, last: boolean, withSummary: boolean) => {
    const shown = textOf(doc, i18n.language).text;
    return (
      <Pressable
        key={doc.id}
        accessibilityRole="button"
        accessibilityLabel={shown.title}
        onPress={() => open(doc.id)}
        style={({ pressed }) => [
          styles.row,
          { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
          last && styles.lastRow,
          pressed && { backgroundColor: colors.surfaceMuted },
        ]}
      >
        <View style={styles.rowText}>
          <Text>{shown.title}</Text>
          {withSummary ? (
            <Text variant="caption" muted numberOfLines={2}>
              {shown.summary}
            </Text>
          ) : null}
        </View>
        <Icon name="chevron-forward" size={18} color="textMuted" />
      </Pressable>
    );
  };
  const tip = (emoji: string, title: string, body: string) => (
    <Text key={title}>
      {`${emoji} `}
      <Text style={styles.bold}>{title}</Text>
      {` ${body}`}
    </Text>
  );

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader
        title={t('help.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
      />
      <View
        style={[styles.bar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
      >
        <View style={styles.brand}>
          <BrandMark size={40} />
          <Text variant="heading">{BRAND_NAME}</Text>
        </View>
        <View style={styles.actions}>
          <HeaderIconButton
            icon="menu-outline"
            label={t('help.menuOpen')}
            onPress={() => setMenu(true)}
          />
          <HeaderIconButton
            icon={searching ? 'close' : 'search-outline'}
            label={searching ? t('help.searchClose') : t('help.searchLabel')}
            onPress={toggleSearch}
          />
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {searching ? (
          <SearchField
            label={t('help.searchPlaceholder')}
            placeholder={t('help.searchPlaceholder')}
            clearLabel={t('common.clear')}
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
          />
        ) : null}
        {results ? (
          results.length > 0 ? (
            <View
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              {results.map((doc, index) => row(doc, index === results.length - 1, true))}
            </View>
          ) : (
            <Text muted accessibilityRole="alert">
              {t('help.noMatch', { q: typed })}
            </Text>
          )
        ) : searching ? null : (
          <>
            <Text variant="title" accessibilityRole="header">
              {t('menu.helpCenter')}
            </Text>
            <Text>{t('help.intro')}</Text>
            <View style={styles.tips}>
              {tip('💡', t('help.tipStartTitle'), t('help.tipStartBody'))}
              {tip('🚀', t('help.tipExploreTitle'), t('help.tipExploreBody'))}
              {tip('❓', t('help.tipHelpTitle'), t('help.tipHelpBody'))}
            </View>
            <Text>{`${t('help.closing')} 🚀`}</Text>
            {HELP_CATEGORIES.map((category) => {
              const docs = docsIn(category);
              return (
                <View
                  key={category}
                  style={[
                    styles.card,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  <Text variant="heading" accessibilityRole="header" style={styles.cardTitle}>
                    {t(CATEGORY_TITLE[category])}
                  </Text>
                  {docs.map((doc, index) => row(doc, index === docs.length - 1, false))}
                </View>
              );
            })}
            {webUrl ? (
              <Button
                variant="secondary"
                label={t('help.web')}
                accessibilityLabel={`${t('help.web')}. ${t('help.webHint')}`}
                onPress={() => void Linking.openURL(webUrl)}
              />
            ) : null}
          </>
        )}
      </ScrollView>
      <HelpDrawer visible={menu} onClose={() => setMenu(false)} onOpenDoc={open} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actions: { flexDirection: 'row', alignItems: 'center' },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  tips: { gap: spacing.sm },
  bold: { fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  cardTitle: { padding: spacing.lg },
  row: {
    minHeight: MIN_TOUCH_TARGET + spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  lastRow: { paddingBottom: spacing.lg },
  rowText: { flex: 1, gap: 2 },
});
