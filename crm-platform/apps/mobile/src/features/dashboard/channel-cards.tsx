import type { DashWidgets } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';
import { Text } from '@/components/ui/text';
import { radius, spacing, type ThemeColors } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { followersLabel } from './format';

const STATE_TONE = { online: 'success', connecting: 'warning', offline: 'danger' } as const;
const STATE_KEY = {
  online: 'dashboard.devices.state.online',
  connecting: 'dashboard.devices.state.connecting',
  offline: 'dashboard.devices.state.offline',
} as const;

/** Connected devices (TW-DASH-014): personal numbers paired by QR. Shown only while the platform has that engine on. */
export function DevicesCard({ data }: { data: DashWidgets['devices'] }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const free = Math.max(0, data.slotCap - data.total);
  return (
    <Panel
      testID="card-devices"
      title={t('dashboard.devices.title')}
      subtitle={t('dashboard.devices.summary', {
        total: data.total,
        cap: data.slotCap,
        online: data.online,
      })}
    >
      {data.rows.length === 0 ? (
        <View style={styles.stack}>
          <Text variant="label">{t('dashboard.devices.emptyTitle')}</Text>
          <Text variant="caption" muted>
            {t('dashboard.devices.emptyBody')}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {data.rows.map((device) => (
            <View key={device.uuid} style={[styles.device, { borderColor: colors.border }]}>
              <View style={styles.fill}>
                <Text variant="label" numberOfLines={1}>
                  {device.phone ?? device.label}
                </Text>
                <Text variant="caption" muted numberOfLines={1}>
                  {`${device.label} - ${device.region ?? t('dashboard.devices.unzoned')} - ${t('dashboard.devices.per24h', { n: device.sent24h })}`}
                </Text>
              </View>
              <View style={styles.deviceEnd}>
                <Badge tone={STATE_TONE[device.state]} label={t(STATE_KEY[device.state])} />
                <Text
                  variant="caption"
                  color={
                    device.deliveryPct >= 95
                      ? 'textMuted'
                      : device.deliveryPct >= 85
                        ? 'warning'
                        : 'danger'
                  }
                >
                  {`${device.deliveryPct}% ${t('dashboard.devices.deliv')}`}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
      {free > 0 ? (
        <Text variant="caption" muted>
          {t('dashboard.devices.free', { count: free })}
        </Text>
      ) : null}
    </Panel>
  );
}

/** Instagram (TW-DASH-008): linked accounts and five numbers. The band does not exist until an account is linked. */
export function InstagramBand({ data }: { data: NonNullable<DashWidgets['instagram']> }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const tiles = [
    ['dashboard.instagram.tile.needReply', data.needsReply.toLocaleString(i18n.language)],
    ['dashboard.instagram.tile.openChats', data.open.toLocaleString(i18n.language)],
    ['dashboard.instagram.tile.dmsIn', data.dmsIn7d.toLocaleString(i18n.language)],
    ['dashboard.instagram.tile.dmsOut', data.dmsOut7d.toLocaleString(i18n.language)],
    ['dashboard.instagram.tile.followers', followersLabel(data.followers)],
  ] as const;
  return (
    <Panel
      testID="ig-band"
      title={t('dashboard.instagram.title')}
      subtitle={t('dashboard.instagram.accounts', { count: data.accountsCount })}
    >
      <View style={styles.chips}>
        {data.accounts.slice(0, 4).map((account) => {
          const connected = account.status.toLowerCase() === 'connected';
          return (
            <View
              key={account.handle}
              accessible
              accessibilityLabel={`${account.handle}, ${connected ? t('dashboard.instagram.connected') : account.status}`}
              style={[styles.chip, { backgroundColor: colors.instagramSoft }]}
            >
              <View
                style={[
                  styles.dot,
                  { backgroundColor: connected ? colors.success : colors.warning },
                ]}
              />
              <Text variant="caption" color="instagram" style={styles.chipText}>
                {account.handle}
              </Text>
            </View>
          );
        })}
      </View>
      <View style={styles.tiles}>
        {tiles.map(([key, value]) => (
          <View key={key} style={[styles.tile, { backgroundColor: colors.instagramSoft }]}>
            <Text variant="caption" color="instagram" numberOfLines={1}>
              {t(key)}
            </Text>
            <Text variant="heading" color="instagram">
              {value}
            </Text>
          </View>
        ))}
      </View>
    </Panel>
  );
}

const INTEGRATION_BADGE = {
  woocommerce: 'Wo',
  shopify: 'Sh',
  google_sheets: 'GS',
  meta_catalog: 'FB',
} as const;

const INTEGRATION_NAME = {
  woocommerce: 'dashboard.integrations.name.woocommerce',
  shopify: 'dashboard.integrations.name.shopify',
  google_sheets: 'dashboard.integrations.name.google_sheets',
  meta_catalog: 'dashboard.integrations.name.meta_catalog',
} as const;

const INTEGRATION_CONNECTED = {
  woocommerce: 'dashboard.integrations.connected.woocommerce',
  shopify: 'dashboard.integrations.connected.shopify',
  google_sheets: 'dashboard.integrations.connected.google_sheets',
  meta_catalog: 'dashboard.integrations.connected.meta_catalog',
} as const;

/** Integrations (TW-DASH-020): four stores and tools, connected or not. */
export function IntegrationsCard({ data }: { data: DashWidgets['integrations'] }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const tone = (connected: boolean): { background: keyof ThemeColors; text: keyof ThemeColors } =>
    connected
      ? { background: 'successSoft', text: 'success' }
      : { background: 'surfaceMuted', text: 'textMuted' };
  return (
    <Panel
      testID="card-integrations"
      title={t('dashboard.integrations.title')}
      trailing={<Badge label={`${data.connected} / ${data.total}`} />}
    >
      <View style={styles.list}>
        {data.rows.map((row) => {
          const colorsOf = tone(row.connected);
          return (
            <View key={row.code} style={styles.integration}>
              <View style={[styles.logo, { backgroundColor: colors[colorsOf.background] }]}>
                <Text variant="caption" color={colorsOf.text} style={styles.logoText}>
                  {INTEGRATION_BADGE[row.code]}
                </Text>
              </View>
              <View style={styles.fill}>
                <Text variant="label">{t(INTEGRATION_NAME[row.code])}</Text>
                <Text variant="caption" muted>
                  {row.connected
                    ? row.events7d !== null
                      ? t('dashboard.integrations.events', { n: row.events7d })
                      : t(INTEGRATION_CONNECTED[row.code])
                    : t('dashboard.integrations.notConnected')}
                </Text>
              </View>
              {row.connected ? (
                <Badge tone="success" label={t('dashboard.integrations.connectedLabel')} />
              ) : null}
            </View>
          );
        })}
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  stack: { gap: spacing.xs },
  list: { gap: spacing.md },
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  deviceEnd: { alignItems: 'flex-end', gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipText: { fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    width: '48%',
    flexGrow: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  integration: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logo: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontWeight: '700' },
});
