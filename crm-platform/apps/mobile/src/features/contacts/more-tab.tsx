import type { ContactResponse } from '@crm/contracts';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Card } from '@/components/ui/card';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { FilesTab } from './files-tab';
import { useContactCompany } from './use-company';
import { useContactDeals } from './use-deals';

function LinkRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: IconName;
  label: string;
  value?: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      onPress={onPress}
      style={styles.row}
    >
      <Icon name={icon} size={22} color="primary" />
      <Text style={styles.label}>{label}</Text>
      {value ? (
        <Text muted numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      <Icon name="chevron-forward" size={18} color="textMuted" />
    </Pressable>
  );
}

/**
 * The More tab: the contact's account (company) and deals, each opening its own read-only screen, then the contact's files.
 * The account row shows for a contact that has one and a person who may read companies; the deals row for a person who may read
 * deals (its number is the deals the API sent, "50+" when it stopped at its limit).
 */
export function MoreTab({ contact, canUpdate }: { contact: ContactResponse; canUpdate: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const session = useSession();
  const canReadCompany = can(session.data, 'record.companies.read') && contact.companyId !== null;
  const canReadDeals = can(session.data, 'record.deals.read');
  const company = useContactCompany(contact.companyId, canReadCompany);
  const deals = useContactDeals(contact.id, canReadDeals);

  const dealCount = deals.data
    ? String(deals.data.rollup.openCount + deals.data.rollup.wonCount)
    : null;
  const hasLinks = canReadCompany || canReadDeals;

  return (
    <View style={styles.root}>
      {hasLinks ? (
        <Card>
          {canReadCompany ? (
            <LinkRow
              icon="business-outline"
              label={t('contacts.detail.more.account')}
              value={company.data?.name}
              onPress={() =>
                router.push({
                  pathname: '/contact-company',
                  params: { companyId: contact.companyId!, contactId: contact.id },
                })
              }
            />
          ) : null}
          {canReadDeals ? (
            <LinkRow
              icon="cash-outline"
              label={t('contacts.detail.more.deals')}
              value={dealCount}
              onPress={() =>
                router.push({ pathname: '/contact-deals', params: { contactId: contact.id } })
              }
            />
          ) : null}
        </Card>
      ) : null}
      <FilesTab contactId={contact.id} canUpdate={canUpdate} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: MIN_TOUCH_TARGET },
  label: { flex: 1 },
});
