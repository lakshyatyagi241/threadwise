import { ERROR_CODES, type ContactResponse } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import type { SubscriptionChannel } from './consent-api';
import { ChoiceRow, EditSheet } from './field-editor';
import { contactKey, useRecordConsent, useUpdateContact } from './use-contacts';
import { describeEditFailure } from './use-properties';

/** The longest note the API takes. */
const NOTE_MAX = 500;

const STATUS_OF: Record<
  SubscriptionChannel,
  'whatsappSubscriptionStatus' | 'emailSubscriptionStatus' | 'smsSubscriptionStatus'
> = {
  whatsapp: 'whatsappSubscriptionStatus',
  email: 'emailSubscriptionStatus',
  sms: 'smsSubscriptionStatus',
};

type Pick = 'granted' | 'withdrawn' | null;

/** Where the contact stands now: opting out of marketing beats any channel label, as it does on the web. */
function pickOf(contact: ContactResponse, channel: SubscriptionChannel): Pick {
  if (contact.isUnsubscribed) return 'withdrawn';
  const status = (contact[STATUS_OF[channel]] ?? '').trim().toLowerCase();
  if (status === 'subscribed') return 'granted';
  return status === 'unsubscribed' ? 'withdrawn' : null;
}

/**
 * Records whether the contact agreed to marketing on one channel (WhatsApp, email or SMS), as the web's Consent card does. The
 * change goes to the consent ledger, which is the proof behind the label; a grant needs a note saying how the person agreed.
 * Choosing only moves the tick; the check in the header saves.
 */
export function ConsentSheet({
  contact,
  channel,
  label,
  onClose,
}: {
  contact: ContactResponse;
  channel: SubscriptionChannel;
  label: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const record = useRecordConsent(contact.id);
  const current = pickOf(contact, channel);
  const [pick, setPick] = useState<Pick>(current);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const choose = (next: Pick) => {
    setPick(next);
    setProblem(null);
    setBanner(null);
  };

  const save = () => {
    setBanner(null);
    if (pick === null || pick === current) {
      onClose();
      return;
    }
    const trimmed = note.trim();
    if (pick === 'granted' && trimmed === '') {
      setProblem(t('contactProps.consent.noteRequired'));
      return;
    }
    record.mutate(
      { channel, action: pick, note: trimmed === '' ? undefined : trimmed },
      {
        onSuccess: onClose,
        onError: (error) => {
          if (isApiError(error) && error.code === ERROR_CODES.CONSENT_NOTE_REQUIRED) {
            setProblem(t('contactProps.consent.noteRequired'));
            return;
          }
          setBanner(messageForError(error, t));
        },
      },
    );
  };

  return (
    <EditSheet
      title={t('contactProps.editor.title', { label })}
      onClose={onClose}
      onSave={save}
      saving={record.isPending}
      saveDisabled={pick === null}
    >
      {banner ? <Banner tone="danger" message={banner} /> : null}
      <Text muted>{t('contactProps.consent.intro')}</Text>
      <View accessibilityRole="radiogroup">
        <ChoiceRow
          label={t('contactProps.subscription.subscribed')}
          role="radio"
          selected={pick === 'granted'}
          onPress={() => choose('granted')}
        />
        <ChoiceRow
          label={t('contactProps.subscription.unsubscribed')}
          role="radio"
          selected={pick === 'withdrawn'}
          onPress={() => choose('withdrawn')}
        />
      </View>
      {pick !== null && pick !== current ? (
        <TextField
          label={
            pick === 'granted'
              ? t('contactProps.consent.noteRequiredLabel')
              : t('contactProps.consent.noteOptionalLabel')
          }
          hint={pick === 'granted' ? t('contactProps.consent.noteHint') : undefined}
          value={note}
          onChangeText={(text) => {
            setNote(text);
            setProblem(null);
          }}
          error={problem}
          multiline
          maxLength={NOTE_MAX}
        />
      ) : null}
    </EditSheet>
  );
}

/**
 * The contact's marketing opt-out: a switch, saved with the version that was read, as the web's contact form does. Turning it on
 * stops marketing messages to the contact on every channel; turning it off lets them be sent again.
 */
export function OptOutSheet({
  contact,
  onClose,
}: {
  contact: ContactResponse;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const update = useUpdateContact(contact.id);
  const [on, setOn] = useState(contact.isUnsubscribed);
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const label = t('contactProps.fields.marketing');

  const save = () => {
    setBanner(null);
    setNotice(null);
    if (on === contact.isUnsubscribed) {
      onClose();
      return;
    }
    update.mutate(
      { isUnsubscribed: on, rowVersion: contact.rowVersion },
      {
        onSuccess: onClose,
        onError: (error) => {
          const failure = describeEditFailure(error, t);
          if (failure.conflict) {
            // Someone else saved first: read the contact again so the next save carries the new version.
            setNotice(t('contactProps.error.conflict'));
            void queryClient.invalidateQueries({ queryKey: contactKey(contact.id) });
            return;
          }
          setBanner(failure.banner ?? t('contactProps.error.invalid'));
        },
      },
    );
  };

  return (
    <EditSheet
      title={t('contactProps.editor.title', { label })}
      onClose={onClose}
      onSave={save}
      saving={update.isPending}
    >
      {banner ? <Banner tone="danger" message={banner} /> : null}
      {notice ? <Banner tone="info" message={notice} /> : null}
      <View style={styles.switchRow}>
        <Text style={styles.grow}>{t('contactProps.optOut.label')}</Text>
        <Switch
          accessibilityLabel={t('contactProps.optOut.label')}
          value={on}
          onValueChange={setOn}
          trackColor={{ false: colors.borderStrong, true: colors.primary }}
          thumbColor={colors.surface}
        />
      </View>
      <Text variant="caption" muted>
        {t('contactProps.optOut.hint')}
      </Text>
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
