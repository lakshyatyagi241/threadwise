import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ButtonRows } from './message-parts';
import { getTemplateDraft, useTemplateDraft } from './template-draft';
import { renderTemplate } from './template-model';

/**
 * Page 3 of sending a template (route /template-preview): the message as the customer will see it, a bubble with the header, the body with
 * what was typed put in, the footer, and the template's buttons. A slot with nothing typed yet still shows its `{{n}}`. Nothing is sent here.
 */
export function TemplatePreviewScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const draft = useTemplateDraft();
  // Nothing to show without a draft (a reload on this page): leave once, when the page opens (not whenever the draft is cleared later, which
  // happens while the page below it is being closed).
  useEffect(() => {
    if (getTemplateDraft()) return;
    if (router.canGoBack()) router.back();
    else router.replace('/inbox');
  }, [router]);
  if (!draft) return null;

  const { template, values } = draft;
  const shown = renderTemplate(template, values);
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <StackHeader
        title={t('inbox.template.previewTitle', { name: template.name })}
        onBack={() => router.back()}
      />
      <ScrollView
        contentContainerStyle={styles.body}
        style={{ backgroundColor: colors.surfaceMuted }}
      >
        <View style={[styles.bubble, { backgroundColor: colors.surface }]}>
          {shown.header ? <Text variant="label">{shown.header}</Text> : null}
          <Text>{shown.body}</Text>
          {shown.footer ? (
            <Text variant="caption" muted>
              {shown.footer}
            </Text>
          ) : null}
          <ButtonRows
            buttons={template.buttons.map((label, i) => ({ key: `${label}-${i}`, label }))}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: spacing.lg },
  bubble: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, maxWidth: '88%' },
});
