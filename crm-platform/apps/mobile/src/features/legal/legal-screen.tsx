import { isLegalSlug, type LegalPagePublic, type LegalSlug } from '@crm/contracts';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { log } from '@/lib/observability/logger';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { parseLegalHtml, type LegalBlock, type LegalRun } from './legal-html';
import { useLegalPage } from './use-legal-page';

const open = (href: string) => {
  Linking.openURL(href).catch((e: unknown) =>
    log.warn('legal.open_failed', { error: e instanceof Error ? e.message : 'unknown' }),
  );
};

/** One line or paragraph of a document: its runs, bold or italic or underlined as written, and a safe link opens outside the app. */
function Runs({ runs }: { runs: readonly LegalRun[] }) {
  return (
    <>
      {runs.map((run, index) => (
        <Text
          key={index}
          accessibilityRole={run.href ? 'link' : undefined}
          color={run.href ? 'action' : undefined}
          onPress={run.href ? () => open(run.href!) : undefined}
          style={[
            run.bold ? styles.bold : null,
            run.italic ? styles.italic : null,
            run.underline || run.href ? styles.underline : null,
          ]}
        >
          {run.text}
        </Text>
      ))}
    </>
  );
}

function Block({ block }: { block: LegalBlock }) {
  const { colors } = useTheme();
  switch (block.t) {
    case 'h':
      return (
        <Text variant="subheading" accessibilityRole="header" style={styles.heading}>
          <Runs runs={block.runs} />
        </Text>
      );
    case 'li':
      return (
        <View style={[styles.item, { marginStart: block.depth * spacing.lg }]}>
          <Text style={styles.marker}>{block.marker}</Text>
          <Text style={styles.itemText}>
            <Runs runs={block.runs} />
          </Text>
        </View>
      );
    case 'quote':
      return (
        <View style={[styles.quote, { borderStartColor: colors.borderStrong }]}>
          <Text muted>
            <Runs runs={block.runs} />
          </Text>
        </View>
      );
    case 'rule':
      return <View style={[styles.rule, { backgroundColor: colors.border }]} />;
    default:
      return (
        <Text>
          <Runs runs={block.runs} />
        </Text>
      );
  }
}

function Document({ page }: { page: LegalPagePublic }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <>
      <Text variant="title" accessibilityRole="header">
        {page.title}
      </Text>
      {page.subtitle ? <Text muted>{page.subtitle}</Text> : null}
      {page.updatedLabel || page.effectiveLabel ? (
        <View style={styles.dates}>
          {page.updatedLabel ? (
            <Text variant="caption" muted>
              {t('legal.updated', { label: page.updatedLabel })}
            </Text>
          ) : null}
          {page.effectiveLabel ? (
            <Text variant="caption" muted>
              {t('legal.effective', { label: page.effectiveLabel })}
            </Text>
          ) : null}
        </View>
      ) : null}
      {page.sections.map((section) => (
        <View key={section.n} style={[styles.section, { borderTopColor: colors.border }]}>
          <View style={styles.sectionHead}>
            <Text variant="heading" color="action">
              {section.n}
            </Text>
            <Text variant="heading" accessibilityRole="header" style={styles.sectionTitle}>
              {section.title}
            </Text>
          </View>
          {parseLegalHtml(section.body).map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </View>
      ))}
    </>
  );
}

/**
 * A legal document of the platform (route /legal/[slug], from Menu > Data & Security): the Terms of Use or the Privacy Policy,
 * read from the same public page the website shows and drawn inside the app, so a person never leaves it. It needs no sign-in. While
 * it loads there is a spinner; when it cannot be read there is the sentence and a "Try again"; an address that is not one of the
 * documents says it is not available.
 */
export function LegalScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const known: LegalSlug | null = slug && isLegalSlug(slug) ? slug : null;
  const query = useLegalPage(known);
  const fallbackTitle =
    known === 'terms'
      ? t('dataSecurity.terms')
      : known === 'privacy'
        ? t('dataSecurity.privacy')
        : t('menu.dataSecurity');

  let body;
  if (!known) {
    body = <Banner tone="warning" message={t('legal.unavailable')} />;
  } else if (query.data) {
    body = <Document page={query.data} />;
  } else if (query.error) {
    body = (
      <View style={styles.stack}>
        <Banner tone="danger" message={messageForError(query.error, t)} />
        <Button
          variant="secondary"
          label={t('common.retry')}
          onPress={() => void query.refetch()}
        />
      </View>
    );
  } else {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader
        title={query.data?.title ?? fallbackTitle}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/data-security'))}
      />
      <ScrollView contentContainerStyle={styles.content}>{body}</ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  stack: { gap: spacing.md },
  loading: { marginTop: spacing.xxl },
  dates: { gap: 2 },
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.lg, gap: spacing.md },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md },
  sectionTitle: { flex: 1 },
  heading: { marginTop: spacing.sm },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
  item: { flexDirection: 'row', gap: spacing.sm },
  marker: { minWidth: 20 },
  itemText: { flex: 1 },
  quote: { borderStartWidth: 3, paddingStart: spacing.md, borderRadius: radius.sm },
  rule: { height: StyleSheet.hairlineWidth },
});
