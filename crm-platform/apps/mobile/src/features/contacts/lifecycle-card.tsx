import type { ContactResponse, StatusOptionResponse } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Icon } from '@/components/ui/icon';
import { SelectField } from '@/components/ui/select-field';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { EditSheet } from './field-editor';
import {
  LOST_REASON_GROUP,
  NO_VALUE,
  OTHER_REASON,
  STAGE_GROUP,
  firstStatusOf,
  lifecycleChanges,
  optionsOfGroup,
  stageChoices,
  statusChoices,
  statusFitsStage,
  titleCaseKey,
} from './property-values';
import { contactKey, useUpdateContact } from './use-contacts';
import { describeEditFailure, useStatusOptions } from './use-properties';

/** The names of the platform's built-in stages and statuses, for a workspace that has not configured its own. */
function useLifecycleLabels() {
  const { t } = useTranslation();
  return {
    stageLabel: (value: string) =>
      t(`contacts.stage.${value}`, { defaultValue: titleCaseKey(value) }),
    statusLabel: (value: string) =>
      t(`contactProps.lifecycle.fallbackStatus.${value}`, { defaultValue: titleCaseKey(value) }),
  };
}

interface SheetProps {
  contact: ContactResponse;
  options: readonly StatusOptionResponse[];
  onClose: () => void;
}

/** A dropdown's label with the red star of a required field. */
function RequiredLabel({ children }: { children: string }) {
  return (
    <Text variant="label">
      {children}
      <Text variant="label" danger>
        {' *'}
      </Text>
    </Text>
  );
}

/**
 * "Edit lifecycle stage/status", the one sheet behind both dropdowns of the strip (the Geta app's popup): two required dropdowns, the
 * stage and its status (which lists only the stage's own statuses and starts at the stage's first when the stage changes), and, for a
 * move into a lost stage, the lost reason (a dropdown with "Other", which asks for words). Save stays off until the form is complete.
 * It is mounted fresh each time it opens, so it starts from the contact.
 */
export function LifecycleSheet({ contact, options, onClose }: SheetProps) {
  const { t } = useTranslation();
  const { stageLabel, statusLabel } = useLifecycleLabels();
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
  const stageList = stageChoices(options, stageLabel, contact.lifecycleStage);
  const chosen = stages.find((o) => o.value === stage);
  const statuses = statusChoices(options, chosen, statusLabel, contact.status);
  // A status that does not belong to the stage is not kept: the stage's first one stands in, as the API would give its default.
  const status =
    pickedStatus !== undefined
      ? pickedStatus
      : stage !== null && statusFitsStage(options, contact.status, stage)
        ? contact.status
        : firstStatusOf(statuses);
  // A move into a lost stage asks why; staying in one does not.
  const askReason = chosen?.isLost === true && stage !== contact.lifecycleStage;
  const showWords = reasons.length === 0 || reason === OTHER_REASON;
  const complete =
    stage !== null &&
    (statuses.length === 0 || status !== null) &&
    (!askReason ||
      (showWords ? reasonText.trim() !== '' : reason !== null && reason !== OTHER_REASON));

  const pickStage = (value: string) => {
    setPickedStage(value);
    setPickedStatus(
      firstStatusOf(
        statusChoices(
          options,
          stages.find((o) => o.value === value),
          statusLabel,
          null,
        ),
      ),
    );
    setReason(null);
    setReasonText('');
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
      title={t('contactProps.lifecycle.edit')}
      onClose={onClose}
      onSave={save}
      saving={update.isPending}
      saveDisabled={!complete}
    >
      {notice ? <Banner tone="warning" message={notice} /> : null}
      {banner ? <Banner tone="danger" message={banner} /> : null}

      <View style={styles.field}>
        <RequiredLabel>{t('contactProps.lifecycle.stage')}</RequiredLabel>
        <SelectField
          label={t('contactProps.lifecycle.stage')}
          placeholder={t('contactProps.lifecycle.choose')}
          options={stageList}
          value={stage ?? undefined}
          onChange={pickStage}
        />
      </View>

      <View style={styles.field}>
        {statuses.length > 0 ? (
          <RequiredLabel>{t('contactProps.lifecycle.statusField')}</RequiredLabel>
        ) : (
          <Text variant="label">{t('contactProps.lifecycle.statusField')}</Text>
        )}
        <SelectField
          label={t('contactProps.lifecycle.statusField')}
          placeholder={statuses.length === 0 ? NO_VALUE : t('contactProps.lifecycle.choose')}
          options={statuses}
          value={status ?? undefined}
          onChange={(value) => setPickedStatus(value)}
          disabled={statuses.length === 0}
        />
      </View>

      {askReason && reasons.length > 0 ? (
        <View style={styles.field}>
          <RequiredLabel>{t('contactProps.lifecycle.lostReason')}</RequiredLabel>
          <SelectField
            label={t('contactProps.lifecycle.lostReason')}
            placeholder={t('contactProps.lifecycle.selectReason')}
            options={[
              ...reasons.map((o) => ({ value: o.value, label: o.label })),
              { value: OTHER_REASON, label: t('contactProps.lifecycle.otherReason') },
            ]}
            value={reason ?? undefined}
            onChange={(value) => {
              setReason(value);
              setProblem(null);
            }}
          />
        </View>
      ) : null}

      {askReason && showWords ? (
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
    </EditSheet>
  );
}

/** One of the two dropdowns: the label above, the current value with a caret under it. Opens the sheet of its own list. */
function Dropdown({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: (() => void) | null;
}) {
  const { t } = useTranslation();
  const body = (
    <>
      <Text variant="caption" color="onBrandMuted">
        {label}
      </Text>
      <View style={styles.value}>
        <Text variant="label" color="onBrand" numberOfLines={1} style={styles.valueText}>
          {value}
        </Text>
        {onPress ? <Icon name="caret-down" size={16} color="onBrand" /> : null}
      </View>
    </>
  );
  if (!onPress) return <View style={styles.cell}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint={t('contactProps.lifecycle.dropdownHint')}
      onPress={onPress}
      style={[styles.cell, styles.touch]}
    >
      {body}
    </Pressable>
  );
}

/**
 * Where the contact stands, in the strip under the name on the header band: the lifecycle stage and the status as dropdowns
 * (each opens a sheet with its own list; only for people who may update contacts), and the lead score (read-only here; scoring
 * itself is a separate concern). The stage and status lists are the workspace's own (the property-read permission); when the
 * person may not read them, or the workspace has none, the strip only shows the current values, with no caret.
 */
export function LifecycleCard({ contact }: { contact: ContactResponse }) {
  const { t } = useTranslation();
  const session = useSession();
  const canUpdate = can(session.data, 'record.contacts.update');
  const canReadOptions = can(session.data, 'record.contact-properties.read');
  // A refused or failed read leaves `data` empty, which is the read-only strip.
  const query = useStatusOptions(canReadOptions);
  const options = query.data ?? [];
  const [open, setOpen] = useState(false);

  const { stageLabel, statusLabel } = useLifecycleLabels();
  // The lists are the workspace's own, or the built-in ones when it has none (as on the web); they are offered once the options were
  // read, so a person who may not read them, or a failed read, sees the values with no caret.
  const editable = canUpdate && canReadOptions && query.isSuccess;

  const stageText = contact.lifecycleStage
    ? (stageChoices(options, stageLabel, contact.lifecycleStage).find(
        (c) => c.value === contact.lifecycleStage,
      )?.label ?? stageLabel(contact.lifecycleStage))
    : NO_VALUE;
  const statusText = contact.status
    ? (statusChoices(options, undefined, statusLabel, contact.status).find(
        (c) => c.value === contact.status,
      )?.label ?? contact.status)
    : NO_VALUE;
  const scoreText = contact.leadScore !== null ? String(contact.leadScore) : NO_VALUE;

  return (
    <>
      <View style={styles.row} testID="lifecycle-card">
        <Dropdown
          label={t('contactProps.lifecycle.stage')}
          value={stageText}
          onPress={editable ? () => setOpen(true) : null}
        />
        <Dropdown
          label={t('contactProps.lifecycle.status')}
          value={statusText}
          onPress={editable ? () => setOpen(true) : null}
        />
        <View style={[styles.cell, styles.touch]}>
          <Text variant="caption" color="onBrandMuted">
            {t('contacts.detail.score')}
          </Text>
          <Text variant="label" color="onBrand" style={styles.valueText}>
            {scoreText}
          </Text>
        </View>
      </View>
      {open ? (
        <LifecycleSheet contact={contact} options={options} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg, alignSelf: 'stretch' },
  cell: { flex: 1, gap: spacing.xs },
  touch: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  value: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  valueText: { flexShrink: 1 },
});
