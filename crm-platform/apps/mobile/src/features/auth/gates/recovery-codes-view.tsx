import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FadeIn } from '@/components/ui/fade-in';
import { Text } from '@/components/ui/text';
import { sessionKey } from '@/lib/session/use-session';
import { radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { GateFrame } from './gate-frame';
import { clearRecoveryCodes } from './recovery-codes-store';

/**
 * The one-time recovery codes after two-factor is on. They are shown once, so the person must say they saved them before the lock screen
 * lets go. There is no clipboard library in the app (a native library needs a new build), so the codes are selectable text and the phone's
 * share sheet offers them to a notes app or a password manager.
 */
export function RecoveryCodesView({ codes }: { codes: readonly string[] }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const share = () => {
    // The share sheet is the person's own choice of where the codes go; a dismissed sheet is not an error.
    void Share.share({ message: codes.join('\n') }).catch(() => undefined);
  };

  const finish = async () => {
    setFinishing(true);
    // The codes are dropped first, then the session is read again: its flag has cleared and the app opens.
    clearRecoveryCodes();
    await queryClient.invalidateQueries({ queryKey: sessionKey });
  };

  return (
    <GateFrame title={t('gates.recovery.title')} signOutDisabled={finishing}>
      <FadeIn>
        <Card>
          <Text>{t('gates.recovery.intro')}</Text>
          <Banner tone="warning" message={t('gates.recovery.onlyOnce')} />
          <View
            accessibilityLabel={t('gates.recovery.listLabel')}
            style={[styles.list, { backgroundColor: colors.surfaceMuted }]}
          >
            {codes.map((code) => (
              <Text key={code} variant="heading" selectable style={styles.code}>
                {code}
              </Text>
            ))}
          </View>
          <Button
            variant="secondary"
            label={t('gates.recovery.share')}
            testID="gate-recovery-share"
            onPress={share}
          />
          <View style={styles.confirm}>
            <Checkbox
              checked={saved}
              onChange={setSaved}
              label={t('gates.recovery.confirmSaved')}
            />
            <Text style={styles.confirmText}>{t('gates.recovery.confirmSaved')}</Text>
          </View>
          <Button
            label={t('gates.recovery.done')}
            testID="gate-recovery-done"
            disabled={!saved}
            loading={finishing}
            onPress={() => void finish()}
          />
        </Card>
      </FadeIn>
    </GateFrame>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.md, gap: spacing.xs, borderRadius: radius.md },
  code: { letterSpacing: 1 },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  confirmText: { flex: 1 },
});
