import { BUSINESS_HOURS_DAY_KEYS, ERROR_CODES, type BusinessHours } from '@crm/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { SelectField } from '@/components/ui/select-field';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import {
  checkDraft,
  draftFrom,
  maskTime,
  toUpdateInput,
  type BusinessHoursDraft,
  type DayProblems,
} from './business-hours-draft';
import { timezoneOptions } from './timezone-options';
import { useBusinessHours, useSaveBusinessHours } from './use-business-hours';

const isPlanLocked = (error: unknown): boolean =>
  isApiError(error) && error.code === ERROR_CODES.PLAN_FEATURE_LOCKED;

/**
 * Settings, Business hours (TW-TIB2-004; the web's dialog of the Auto-assignment screen): the weekly opening hours and the time zone
 * that the routing condition "outside business hours" and the SLA clock read. A day that is switched off is closed all day; until a
 * schedule is saved the workspace counts as open all the time. Reading needs `inbox.settings.read` and saving `inbox.routing.manage`
 * (a person with only the first sees the hours but cannot change them); the time zone is the workspace owner's alone. The plan needs
 * auto-assignment (`PLAN_FEATURE_LOCKED` otherwise, reads included).
 */
export function BusinessHoursScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const session = useSession();
  const canRead = can(session.data, 'inbox.settings.read');
  const canManage = can(session.data, 'inbox.routing.manage');
  const hours = useBusinessHours(canRead);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/menu'));

  let body;
  if (session.data === undefined || (canRead && hours.isPending)) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (!canRead) {
    body = <EmptyState icon="lock-closed-outline" title={t('settings.businessHours.noAccess')} />;
  } else if (hours.isError) {
    body = isPlanLocked(hours.error) ? (
      <EmptyState icon="lock-closed-outline" title={t('settings.businessHours.planLocked')} />
    ) : (
      <View style={styles.pad}>
        <Card>
          <Text danger accessibilityRole="alert">
            {messageForError(hours.error, t)}
          </Text>
          <Button
            variant="secondary"
            label={t('common.retry')}
            onPress={() => void hours.refetch()}
          />
        </Card>
      </View>
    );
  } else if (hours.data) {
    // Keyed by what the server holds, so a save (or a read after one) shows exactly that.
    body = <HoursForm key={JSON.stringify(hours.data)} hours={hours.data} canManage={canManage} />;
  } else {
    // The read is switched off (not signed in yet, or paused): nothing to show but the wait.
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={t('settings.businessHours.title')} onBack={goBack} />
      {body}
    </View>
  );
}

function HoursForm({ hours, canManage }: { hours: BusinessHours; canManage: boolean }) {
  const { t } = useTranslation();
  const save = useSaveBusinessHours();
  const [draft, setDraft] = useState<BusinessHoursDraft>(() => draftFrom(hours));
  const [problems, setProblems] = useState<DayProblems>({});
  const [banner, setBanner] = useState<{ tone: 'info' | 'danger'; message: string } | null>(null);
  const zoneEditable = canManage && hours.canEditTimezone;

  const setDay = (
    key: (typeof BUSINESS_HOURS_DAY_KEYS)[number],
    patch: Partial<BusinessHoursDraft['days'][typeof key]>,
  ) => setDraft((d) => ({ ...d, days: { ...d.days, [key]: { ...d.days[key], ...patch } } }));

  const submit = () => {
    setBanner(null);
    const found = checkDraft(draft);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    save.mutate(toUpdateInput(draft, hours.canEditTimezone), {
      onSuccess: () => setBanner({ tone: 'info', message: t('settings.businessHours.saved') }),
      onError: (e) =>
        setBanner({
          tone: 'danger',
          message: isPlanLocked(e) ? t('settings.businessHours.planLocked') : messageForError(e, t),
        }),
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text muted>{t('settings.businessHours.subtitle')}</Text>
        {banner ? <Banner tone={banner.tone} message={banner.message} /> : null}
        {!canManage ? <Banner tone="info" message={t('settings.businessHours.viewOnly')} /> : null}

        <View style={styles.group}>
          <Text variant="label">{t('settings.businessHours.timezone')}</Text>
          {zoneEditable ? (
            <SelectField
              label={t('settings.businessHours.timezone')}
              placeholder={draft.timezone}
              options={timezoneOptions(hours.timezone)}
              value={draft.timezone}
              onChange={(zone) => setDraft((d) => ({ ...d, timezone: zone }))}
            />
          ) : (
            <Text accessibilityLabel={`${t('settings.businessHours.timezone')}: ${hours.timezone}`}>
              {hours.timezone}
            </Text>
          )}
          <Text variant="caption" muted>
            {zoneEditable
              ? t('settings.businessHours.timezoneHint')
              : t('settings.businessHours.timezoneOwnerOnly')}
          </Text>
        </View>

        <View style={styles.group}>
          <Text variant="label" accessibilityRole="header">
            {t('settings.businessHours.days')}
          </Text>
          {BUSINESS_HOURS_DAY_KEYS.map((key) => {
            const day = draft.days[key];
            const problem = problems[key];
            const name = t(`settings.businessHours.day.${key}`);
            return (
              <Card key={key}>
                <View style={styles.dayHead}>
                  <Checkbox
                    checked={day.enabled}
                    onChange={(enabled) => setDay(key, { enabled })}
                    label={name}
                    disabled={!canManage || save.isPending}
                  />
                  <Text variant="heading">{name}</Text>
                </View>
                <View style={styles.times}>
                  <View style={styles.time}>
                    <TextField
                      label={`${name} ${t('settings.businessHours.from')}`}
                      value={day.from}
                      onChangeText={(v) => setDay(key, { from: maskTime(v) })}
                      editable={canManage && !save.isPending}
                      keyboardType="number-pad"
                      maxLength={5}
                      error={problem ? t(`settings.businessHours.problem.${problem}`) : undefined}
                    />
                  </View>
                  <View style={styles.time}>
                    <TextField
                      label={`${name} ${t('settings.businessHours.to')}`}
                      value={day.to}
                      onChangeText={(v) => setDay(key, { to: maskTime(v) })}
                      editable={canManage && !save.isPending}
                      keyboardType="number-pad"
                      maxLength={5}
                    />
                  </View>
                </View>
              </Card>
            );
          })}
        </View>

        <Text variant="caption" muted>
          {t('settings.businessHours.note')}
        </Text>

        {canManage ? (
          <Button
            label={t('settings.businessHours.save')}
            testID="business-hours-save"
            loading={save.isPending}
            onPress={submit}
          />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: { marginTop: spacing.xl },
  pad: { padding: spacing.lg },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  group: { gap: spacing.sm },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  times: { flexDirection: 'row', gap: spacing.md },
  time: { flex: 1 },
});
