import type { ContactResponse, TagResponse } from '@crm/contracts';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { SearchField } from '@/components/ui/search-field';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ContactTags } from './contact-tags';
import { FieldEditor } from './field-editor';
import { OwnerPicker } from './owner-picker';
import { PropertyRowView } from './property-row';
import {
  buildRows,
  groupRows,
  searchRows,
  visibleRows,
  type Editable,
  type PropertyRow,
} from './property-values';
import { isDenied, useAssignees, useContactFields, useFieldSections } from './use-properties';

/** How long "You can't edit X" stays on screen. */
const NOTICE_MS = 4000;

/**
 * The About tab: one card, "Contact information", with the contact's email, phone, owner and name, what the system knows about
 * them, and then the workspace's own properties. Empty rows stay hidden until "Show empty fields" is on. People who may update
 * contacts get a pencil on every row that can be edited and a short notice on one that cannot. Reading the property list needs
 * the property-read permission; without it the tab still shows the values, under their keys.
 */
export function AboutTab({
  contact,
  tags,
}: {
  contact: ContactResponse;
  /** The contact's tags, shown (and edited, for people who may update contacts) at the end of the tab. */
  tags: readonly TagResponse[];
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const session = useSession();
  const canUpdate = can(session.data, 'record.contacts.update');
  const canReadFields = can(session.data, 'record.contact-properties.read');
  const fields = useContactFields(canReadFields);
  const assignees = useAssignees(can(session.data, 'record.contacts.read'));
  const sections = useFieldSections(canReadFields);

  const [open, setOpen] = useState(true);
  const [showEmpty, setShowEmpty] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editable | 'owner' | null>(null);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const ownerName = assignees.data?.find((a) => a.id === contact.ownerId)?.fullName ?? null;
  const groups = useMemo(
    () =>
      groupRows(
        searchRows(
          visibleRows(
            buildRows({
              contact,
              // A refused read (403) leaves no definitions; the values are then shown under their keys.
              fields: fields.data,
              ownerName,
              locale: i18n.language,
              t,
            }),
            showEmpty,
          ),
          search,
        ),
        fields.data,
        sections.data,
      ),
    [contact, fields.data, sections.data, ownerName, i18n.language, t, showEmpty, search],
  );
  const fieldsFailed = fields.isError && !isDenied(fields.error);

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

  return (
    <View style={styles.tab}>
      <Card>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('contactProps.title')}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(!open)}
          style={styles.header}
        >
          <Text variant="subheading" style={styles.grow}>
            {t('contactProps.title')}
          </Text>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={22} />
        </Pressable>

        {open ? (
          <>
            <SearchField
              label={t('contactProps.search')}
              placeholder={t('contactProps.search')}
              clearLabel={t('common.clear')}
              value={search}
              onChangeText={setSearch}
            />
            <View style={styles.switchRow}>
              <Text style={styles.grow}>{t('contactProps.showEmpty')}</Text>
              <Switch
                accessibilityLabel={t('contactProps.showEmpty')}
                value={showEmpty}
                onValueChange={setShowEmpty}
                trackColor={{ false: colors.borderStrong, true: colors.primary }}
                thumbColor={colors.surface}
              />
            </View>
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
            {groups.map((group, index) => (
              <View key={group.title ?? `rest-${index}`}>
                {group.title ? (
                  <Text
                    variant="overline"
                    muted
                    accessibilityRole="header"
                    style={styles.sectionTitle}
                  >
                    {group.title}
                  </Text>
                ) : null}
                {group.rows.map((row) => (
                  <PropertyRowView
                    key={row.id}
                    row={row}
                    tappable={canUpdate}
                    onPress={() => press(row)}
                  />
                ))}
              </View>
            ))}
            {canReadFields && fields.isPending ? (
              <ActivityIndicator accessibilityLabel={t('common.loading')} />
            ) : null}
          </>
        ) : null}
      </Card>

      <ContactTags contactId={contact.id} tags={tags} editable={canUpdate} />

      <View style={styles.footerBlock}>
        <Text variant="caption" muted style={styles.footer}>
          {t('contactProps.footer')}
        </Text>
        {/* Every property of the workspace in its section, empty ones too: the Geta app's "View all properties". */}
        {canReadFields ? (
          <Button
            variant="link"
            align="center"
            label={t('contactProps.viewAll')}
            onPress={() =>
              router.push({ pathname: '/contact-properties', params: { id: contact.id } })
            }
          />
        ) : null}
      </View>

      {editing === 'owner' ? (
        <OwnerPicker contact={contact} onClose={() => setEditing(null)} />
      ) : editing ? (
        <FieldEditor contact={contact} edit={editing} onClose={() => setEditing(null)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tab: { gap: spacing.lg },
  header: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  grow: { flex: 1 },
  switchRow: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  footerBlock: { gap: spacing.xs },
  footer: { paddingHorizontal: spacing.xs, textAlign: 'center' },
  sectionTitle: { paddingTop: spacing.md, paddingBottom: spacing.xs },
});
