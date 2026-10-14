import type { ContactResponse, StatusOptionResponse } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { ChoiceRow, EditSheet } from './field-editor';
import {
  LOST_REASON_GROUP,
  NO_VALUE,
  OTHER_REASON,
  STAGE_GROUP,
  STATUS_GROUPS,
  lifecycleChanges,
  optionsOfGroup,
  statusFitsStage,
  statusesForStage,
  titleCaseKey,
} from './property-values';
import { contactKey, useUpdateContact } from './use-contacts';
import { describeEditFailure, useStatusOptions } from './use-properties';

interface SheetProps {
  contact: ContactResponse;
  options: readonly StatusOptionResponse[];
  onClose: () => void;
}

/** The sheet that changes the stage and status. It is mounted fresh each time it opens, so it starts from the contact. */
function LifecycleSheet({ contact, options, onClose }: SheetProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const update = useUpdateContact(contact.id);
  const stages = optionsOfGroup(options, [STAGE_GROUP]);
  const reasons = optionsOfGroup(options, [LOST_REASON_GROUP]);

  // What the person picked; undefined is "not touched", which follows the contact. After a conflict the contact is read again, and
  // whatever the person did not touch then shows the other person's value instead of overwriting it.
  const [pickedStage, setPickedStage] = useState<string | undefined>();
  const [pickedStatus, setPickedStatus] = useState<string | null | undefined>();
  const [reason, setReason] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const stage = pickedStage ?? contact.lifecycleStage;
  // A status that does not belong to the stage is shown unticked; the API then gives the stage's own default.
  const status =
    pickedStatus !== undefined
      ? pickedStatus
      : stage !== null && statusFitsStage(options, contact.status, stage)
        ? contact.status
        : null;
  const chosen = stages.find((o) => o.value === stage);
  const statuses = statusesForStage(options, chosen);
  // A move into a lost stage asks why; staying in one does not.
  const askReason = chosen?.isLost === true && stage !== contact.lifecycleStage;
  const showWords = reasons.length === 0 || reason === OTHER_REASON;

  const pickStage = (value: string) => {
    setPickedStage(value);
    setPickedStatus((current) =>
      current !== undefined && current !== null && !statusFitsStage(options, current, value)
        ? undefined
        : current,
    );
    setProblem(null);
  };

  const save = () => {
    setBanner(null);
    setNotice(null);
    const result = lifecycleChanges(
      contact,
      { stage, status, reason, reasonText },
      askReason,
      reasons.length > 0,
    );
    if (!result.ok) {
      setProblem(t('contactProps.error.lostReasonRequired'));
      return;
    }
    if (Object.keys(result.changes).length === 0) {
      onClose();
      return;
    }
    update.mutate(
      { ...result.changes, rowVersion: contact.rowVersion },
      {
        onSuccess: onClose,
        onError: (error) => {
          const failure = describeEditFailure(error, t);
          if (failure.conflict) {
            setNotice(t('contactProps.error.conflict'));
            void queryClient.invalidateQueries({ queryKey: contactKey(contact.id) });
            return;
          }
          setBanner(failure.banner ?? failure.field);
        },
      },
    );
  };

  return (
    <EditSheet
      title={t('contactProps.lifecycle.change')}
      onClose={onClose}
      onSave={save}
      saving={update.isPending}
    >
      {notice ? <Banner tone="warning" message={notice} /> : null}
      {banner ? <Banner tone="danger" message={banner} /> : null}

      {stages.length > 0 ? (
        <View accessibilityRole="radiogroup">
          <Text variant="label" muted>
            {t('contactProps.lifecycle.stage')}
          </Text>
          {stages.map((option) => (
            <ChoiceRow
              key={option.id}
              label={option.label}
              role="radio"
              selected={option.value === stage}
              onPress={() => pickStage(option.value)}
            />
          ))}
        </View>
      ) : null}

      {statuses.length > 0 ? (
        <View accessibilityRole="radiogroup">
          <Text variant="label" muted>
            {t('contactProps.lifecycle.status')}
          </Text>
          {statuses.map((option) => (
            <ChoiceRow
              key={option.id}
              label={option.label}
              role="radio"
              selected={option.value === status}
              onPress={() => setPickedStatus(option.value)}
            />
          ))}
        </View>
      ) : null}

      {askReason ? (
        <View accessibilityRole="radiogroup">
          <Text variant="label" muted>
            {t('contactProps.lifecycle.lostReason')}
          </Text>
          {reasons.map((option) => (
            <ChoiceRow
              key={option.id}
              label={option.label}
              role="radio"
              selected={option.value === reason}
              onPress={() => {
                setReason(option.value);
                setProblem(null);
              }}
            />
          ))}
          {reasons.length > 0 ? (
            <ChoiceRow
              label={t('contactProps.lifecycle.otherReason')}
              role="radio"
              selected={reason === OTHER_REASON}
              onPress={() => {
                setReason(OTHER_REASON);
                setProblem(null);
              }}
            />
          ) : null}
          {showWords ? (
            <TextField
              label={t('contactProps.lifecycle.otherLabel')}
              value={reasonText}
              onChangeText={(text) => {
                setReasonText(text);
                setProblem(null);
              }}
              maxLength={500}
              multiline
            />
          ) : null}
          {problem ? (
            <Text variant="caption" danger accessibilityRole="alert">
              {problem}
            </Text>
          ) : null}
        </View>
      ) : null}
    </EditSheet>
  );
}

/**
 * Where the contact stands: its lifecycle stage and status, with a pencil for people who may update contacts, plus its lead
 * score (read-only here; scoring itself is a separate concern). The stage and status lists are the workspace's own (the
 * property-read permission); when the person may not read them, or the workspace has none, the card only shows the current
 * values and offers no pencil.
 */
export function LifecycleCard({ contact }: { contact: ContactResponse }) {
  const { t } = useTranslation();
  const session = useSession();
  const canUpdate = can(session.data, 'record.contacts.update');
  const canReadOptions = can(session.data, 'record.contact-properties.read');
  // A refused or failed read leaves `data` empty, which is the read-only card.
  const query = useStatusOptions(canReadOptions);
  const options = query.data ?? [];
  const [open, setOpen] = useState(false);

  const stages = optionsOfGroup(options, [STAGE_GROUP]);
  const statuses = optionsOfGroup(options, STATUS_GROUPS);
  const editable = canUpdate && (stages.length > 0 || statuses.length > 0);

  const stageText = contact.lifecycleStage
    ? (stages.find((o) => o.value === contact.lifecycleStage)?.label ??
      t(`contacts.stage.${contact.lifecycleStage}`, {
        defaultValue: titleCaseKey(contact.lifecycleStage),
      }))
    : NO_VALUE;
  const statusText = contact.status
    ? (statuses.find((o) => o.value === contact.status)?.label ?? contact.status)
    : NO_VALUE;
  const scoreText = contact.leadScore !== null ? String(contact.leadScore) : NO_VALUE;

  return (
    <>
      <Card>
        <View style={styles.row} testID="lifecycle-card">
          <View style={styles.cell}>
            <Text variant="caption" muted>
              {t('contactProps.lifecycle.stage')}
            </Text>
            <Text>{stageText}</Text>
          </View>
          <View style={styles.cell}>
            <Text variant="caption" muted>
              {t('contactProps.lifecycle.status')}
            </Text>
            <Text>{statusText}</Text>
          </View>
          <View style={styles.cell}>
            <Text variant="caption" muted>
              {t('contacts.detail.score')}
            </Text>
            <Text>{scoreText}</Text>
          </View>
          {editable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('contactProps.lifecycle.change')}
              onPress={() => setOpen(true)}
              style={styles.pencil}
            >
              <Icon name="create-outline" size={22} color="primary" />
            </Pressable>
          ) : null}
        </View>
      </Card>
      {open ? (
        <LifecycleSheet contact={contact} options={options} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  cell: { flex: 1, gap: spacing.xs },
  pencil: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
