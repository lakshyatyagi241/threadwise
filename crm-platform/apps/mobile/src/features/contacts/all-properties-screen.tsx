import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { FieldEditor } from './field-editor';
import { PropertyRowView } from './property-row';
import { OwnerPicker } from './owner-picker';
import {
  LOST_REASON_GROUP,
  STAGE_GROUP,
  buildRows,
  groupRows,
  optionsOfGroup,
  titleCaseKey,
  visibleRows,
  type Editable,
  type PropertyRow,
} from './property-values';
import { firstParam } from './record-support';
import { useContact } from './use-contacts';
import {
  isDenied,
  useAssignees,
  useContactFields,
  useFieldSections,
  useStatusOptions,
} from './use-properties';

/** How long "You can't edit X" stays on screen. */
const NOTICE_MS = 4000;

/**
 * "All sections": every property of the workspace, grouped under the workspace's own section names, empty ones included (shown as
 * dashes). The first section opens expanded and the others fold, as in the Geta app. A standard property (email, mobile phone number,
 * lifecycle stage, the subscription statuses) shows what the contact holds in its own column, so the data matches the About tab.
 * People who may update contacts get a pencil on the custom properties that can be edited.
 */
export function AllPropertiesScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = firstParam(params.id);
  const session = useSession();
  const canRead = can(session.data, 'record.contacts.read');
  const canUpdate = can(session.data, 'record.contacts.update');
  const canReadFields = can(session.data, 'record.contact-properties.read');
  const contact = useContact(id, canRead);
  const fields = useContactFields(canReadFields);
  const sections = useFieldSections(canReadFields);
  const options = useStatusOptions(canReadFields);
  const assignees = useAssignees(canRead);

  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editable | 'owner' | null>(null);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const data = contact.data;
  const ownerName = assignees.data?.find((a) => a.id === data?.ownerId)?.fullName ?? null;
  const groups = useMemo(() => {
    if (!data) return [];
    const stages = optionsOfGroup(options.data, [STAGE_GROUP]);
    const reasons = optionsOfGroup(options.data, [LOST_REASON_GROUP]);
    const rows = buildRows({
      contact: data,
      fields: fields.data,
      ownerName,
      locale: i18n.language,
      t,
      standard: {
        stageLabel: (value) =>
          stages.find((o) => o.value === value)?.label ??
          t(`contacts.stage.${value}`, { defaultValue: titleCaseKey(value) }),
        lostReasonLabel: (value) => reasons.find((o) => o.value === value)?.label ?? value,
      },
    })
      // The fixed rows belong to the About tab; this screen lists the workspace's properties.
      .filter((row) => row.id.startsWith('field:'));
    return groupRows(visibleRows(rows, true), fields.data, sections.data);
  }, [data, fields.data, sections.data, options.data, ownerName, i18n.language, t]);

  const goBack = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: '/contact/[id]', params: { id } });

  const press = (row: PropertyRow) => {
    const { edit } = row;
    if (edit.kind === 'locked') {
      setNotice(
        t(edit.reason === 'unsupported' ? 'contactProps.webOnly' : 'contactProps.locked', {
          label: row.label,
        }),
      );
      return;
    }
    setNotice(null);
    setEditing(edit.kind === 'owner' ? 'owner' : edit);
  };

  const fieldsFailed = fields.isError && !isDenied(fields.error);
  let body;
  if (session.data === undefined || (canRead && contact.isPending)) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (!canRead || !data) {
    body = <EmptyState icon="lock-closed-outline" title={t('contacts.detail.notFound')} />;
  } else {
    body = (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {notice ? <Banner tone="info" message={notice} /> : null}
        {fieldsFailed ? (
          <View>
            <Banner tone="danger" message={messageForError(fields.error, t)} />
            <Button
              variant="link"
              align="start"
              label={t('common.retry')}
              onPress={() => void fields.refetch()}
            />
          </View>
        ) : null}
        {canReadFields && fields.isPending ? (
          <ActivityIndicator accessibilityLabel={t('common.loading')} />
        ) : null}
        {groups.map((group, index) => {
          const key = group.title ?? `rest-${index}`;
          // The first section starts open and the rest folded, until the person opens or folds one.
          const isFolded = folded[key] ?? index > 0;
          return (
            <Card key={key}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={group.title ?? t('contactProps.otherSection')}
                accessibilityState={{ expanded: !isFolded }}
                onPress={() => setFolded({ ...folded, [key]: !isFolded })}
                style={styles.header}
              >
                <Text variant="subheading" style={styles.grow}>
                  {group.title ?? t('contactProps.otherSection')}
                </Text>
                <Icon name={isFolded ? 'chevron-down' : 'chevron-up'} size={22} />
              </Pressable>
              {isFolded
                ? null
                : group.rows.map((row) => (
                    <PropertyRowView
                      key={row.id}
                      row={row}
                      tappable={canUpdate}
                      onPress={() => press(row)}
                    />
                  ))}
            </Card>
          );
        })}
        {groups.length === 0 && !fields.isPending && !fieldsFailed ? (
          <EmptyState icon="list-outline" title={t('contactProps.noProperties')} />
        ) : null}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={t('contactProps.allTitle')} onBack={goBack} />
      {body}
      {data && editing === 'owner' ? (
        <OwnerPicker contact={data} onClose={() => setEditing(null)} />
      ) : data && editing !== null && editing !== 'owner' ? (
        <FieldEditor contact={data} edit={editing} onClose={() => setEditing(null)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: { marginVertical: spacing.xl },
  content: { padding: spacing.lg, gap: spacing.md },
  header: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  grow: { flex: 1 },
});
