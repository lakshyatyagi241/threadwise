import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { useCallerId } from './use-caller-id';

interface RequirementProps {
  label: string;
  allowed: boolean;
  onAllow: () => void;
}

function Requirement({ label, allowed, onAllow }: RequirementProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.requirement}>
      <Icon
        name={allowed ? 'checkmark-circle' : 'ellipse-outline'}
        size={22}
        color={allowed ? 'success' : 'textMuted'}
      />
      <View style={styles.requirementText}>
        <Text>{label}</Text>
        <Text variant="caption" muted>
          {allowed ? t('calls.callerId.allowed') : t('calls.callerId.missing')}
        </Text>
      </View>
      {allowed ? null : (
        <Button variant="secondary" label={t('calls.callerId.allow')} onPress={onAllow} />
      )}
    </View>
  );
}

/**
 * Caller ID (route /caller-id, from Menu > Preferences): when a contact calls the phone, the name shows over the call screen, like
 * the card of the CRM apps, and a tap opens the contact. The screen says what it keeps (names and numbers of the contacts, on this
 * phone only), asks for what Android requires one step at a time, and turns it on or off. A build without the caller-ID part says so.
 */
export function CallerIdScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const caller = useCallerId();
  const { status } = caller;
  const ready = caller.phoneState && caller.callLog && caller.overlay;

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader
        title={t('calls.callerId.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {!caller.available ? (
          <Banner tone="warning" message={t('calls.callerId.unavailable')} />
        ) : (
          <>
            <Text>{t('calls.callerId.intro')}</Text>
            <Text muted>{t('calls.callerId.privacy')}</Text>
            {!caller.canRead ? (
              <Banner tone="warning" message={t('calls.callerId.noAccess')} />
            ) : null}
            {caller.failed ? <Banner tone="danger" message={t('calls.callerId.failed')} /> : null}
            <Card>
              <Text variant="subheading" accessibilityRole="header">
                {status.enabled ? t('calls.callerId.statusOn') : t('calls.callerId.statusOff')}
              </Text>
              {status.enabled ? (
                <View>
                  <Text muted>{t('calls.callerId.ready', { number: status.count })}</Text>
                  {status.updatedAt > 0 ? (
                    <Text variant="caption" muted>
                      {t('calls.callerId.updated', {
                        when: new Date(status.updatedAt).toLocaleString(i18n.language),
                      })}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {status.enabled ? (
                <View style={styles.actions}>
                  <Button
                    variant="secondary"
                    label={t('calls.callerId.updateNow')}
                    loading={caller.busy}
                    onPress={() => void caller.updateNow()}
                  />
                  <Button
                    variant="secondary"
                    label={t('calls.callerId.turnOff')}
                    onPress={caller.turnOff}
                  />
                </View>
              ) : (
                <Button
                  label={t('calls.callerId.turnOn')}
                  loading={caller.busy}
                  disabled={!caller.canRead}
                  onPress={() => void caller.turnOn()}
                />
              )}
            </Card>
            {ready && status.enabled ? null : (
              <Card>
                <Text variant="subheading" accessibilityRole="header">
                  {t('calls.callerId.requirements')}
                </Text>
                <Requirement
                  label={t('calls.callerId.reqPhone')}
                  allowed={caller.phoneState}
                  onAllow={() => void caller.allowPermissions()}
                />
                <Requirement
                  label={t('calls.callerId.reqLog')}
                  allowed={caller.callLog}
                  onAllow={() => void caller.allowPermissions()}
                />
                <Requirement
                  label={t('calls.callerId.reqOverlay')}
                  allowed={caller.overlay}
                  onAllow={caller.allowOverlay}
                />
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  actions: { gap: spacing.sm },
  requirement: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  requirementText: { flex: 1 },
});
