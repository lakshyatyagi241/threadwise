import type { RegistrationConfigResponse } from '@crm/contracts';
import { Trans } from 'react-i18next';
import { Linking, StyleSheet } from 'react-native';
import { Text } from '@/components/ui/text';
import { env } from '@/config/env';
import { log } from '@/lib/observability/logger';
import { resolveLegalUrl } from '@/lib/links/legal-url';

type Links = RegistrationConfigResponse['links'];

/** The sentence without its `<terms>` and `<privacy>` tags: what a screen reader says for the checkbox next to it. */
export const plainText = (text: string): string => text.replace(/<\/?\w+>/g, '');

function open(url: string): void {
  Linking.openURL(url).catch((e: unknown) =>
    log.warn('legal.open_failed', { error: e instanceof Error ? e.message : 'unknown' }),
  );
}

/**
 * "By signing in you agree to our Terms and Privacy policy" and "I agree to the Terms and Privacy policy", with the two names as
 * links to the pages the platform's administrator set. A name whose address cannot be opened (a path with no web address
 * configured, an unsafe value) stays plain text rather than becoming a dead link.
 */
export function LegalText({
  i18nKey,
  links,
}: {
  i18nKey: 'auth.legalSignIn' | 'signUp.agree';
  links: Links;
}) {
  const named = (href: string | null) => {
    const url = resolveLegalUrl(href, env.webUrl, { allowHttp: env.variant === 'development' });
    return url ? (
      <Text
        variant="caption"
        color="primary"
        accessibilityRole="link"
        style={styles.name}
        onPress={() => open(url)}
      />
    ) : (
      <Text variant="caption" style={styles.name} />
    );
  };
  return (
    <Text variant="caption" muted>
      <Trans
        i18nKey={i18nKey}
        components={{ terms: named(links.terms), privacy: named(links.privacy) }}
      />
    </Text>
  );
}

const styles = StyleSheet.create({ name: { fontWeight: '600' } });
