import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { InfoRow } from './info-row';
import { ErrorCard } from './record-parts';
import { failureKindOf, firstParam } from './record-support';
import { useContactCompany } from './use-company';

/**
 * The company a contact belongs to (/contact-company?companyId=…&contactId=…), read only: who it is and how to reach it.
 * Reading a company needs `record.companies.read`.
 */
export function ContactCompanyScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    companyId?: string | string[];
    contactId?: string | string[];
  }>();
  const companyId = firstParam(params.companyId);
  const contactId = firstParam(params.contactId);
  const session = useSession();
  const canRead = can(session.data, 'record.companies.read');
  const company = useContactCompany(companyId, canRead);

  const back = () => {
    if (router.canGoBack()) router.back();
    else if (contactId) router.replace({ pathname: '/contact/[id]', params: { id: contactId } });
    else router.replace('/contacts');
  };

  const denied = (
    <EmptyState
      icon="lock-closed-outline"
      title={t('contactCompany.denied.title')}
      hint={t('contactCompany.denied.hint')}
    />
  );
  const missing = <EmptyState icon="business-outline" title={t('contactCompany.missing')} />;

  let body;
  if (session.data === undefined || (canRead && company.isPending && companyId !== '')) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (!canRead) {
    body = denied;
  } else if (companyId === '') {
    body = missing;
  } else if (company.isError) {
    const kind = failureKindOf(company.error);
    body =
      kind === 'missing' ? (
        missing
      ) : kind === 'denied' ? (
        denied
      ) : (
        <View style={styles.pad}>
          <ErrorCard error={company.error} onRetry={() => void company.refetch()} />
        </View>
      );
  } else if (!company.data) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else {
    const c = company.data;
    body = (
      <ScrollView contentContainerStyle={styles.pad}>
        <Card>
          <Text variant="heading" accessibilityRole="header">
            {c.name}
          </Text>
          <InfoRow label={t('contactCompany.industry')} value={c.industry} />
          <InfoRow label={t('contactCompany.size')} value={c.sizeRange} />
          <InfoRow label={t('contactCompany.phone')} value={c.phone} />
          <InfoRow label={t('contactCompany.email')} value={c.email} />
          <InfoRow label={t('contactCompany.website')} value={c.website} />
          <InfoRow label={t('contactCompany.address')} value={c.address} />
          <InfoRow label={t('contactCompany.owner')} value={c.owner?.name} />
          <InfoRow label={t('contactCompany.notes')} value={c.notes} />
        </Card>
      </ScrollView>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={t('contactCompany.title')} onBack={back} />
      <View style={styles.fill}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: spacing.lg },
  loading: { marginTop: spacing.xxl },
});
