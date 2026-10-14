import { createContactActivitySchema, type ContactActivityResponse } from '@crm/contracts';
import { useRouter, type Href } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { formatMoment } from './contact-display';
import { ErrorCard } from './record-parts';
import { failureKindOf, joinMeta } from './record-support';
import { useContactActivities, useCreateActivity } from './use-activity';
import { useContactNotes } from './use-notes';

interface Props {
  contactId: string;
  /** Whether the person may log an activity (`record.contacts.update`). */
  canUpdate: boolean;
  /** Leaves out the notes and tasks tiles, for a screen that already lists them above. */
  hideTiles?: boolean;
}

/** What a new entry is called until the person types another word: the API takes any text up to 100 characters. */
const DEFAULT_TYPE = 'note';

/** The kinds of entry the app has a word for. Any other type is shown as the API sent it, tidied up. */
const KNOWN_TYPES = ['note', 'call', 'email', 'meeting', 'task'] as const;
const isKnownType = (type: string): type is (typeof KNOWN_TYPES)[number] =>
  (KNOWN_TYPES as readonly string[]).includes(type);

function typeLabel(type: string, t: TFunction): string {
  if (isKnownType(type)) return t(`contactNotes.activity.types.${type}`);
  const spaced = type.replace(/[_.-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function Tile({
  icon,
  label,
  total,
  onPress,
}: {
  icon: IconName;
  label: string;
  /** How many there are, when that is known. */
  total: string | null;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={total ? `${label}, ${total}` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: pressed ? colors.primarySoft : colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={[styles.tileIcon, { backgroundColor: colors.primarySoft }]}>
        <Icon name={icon} size={22} color="primary" />
      </View>
      <Text variant="label" muted>
        {label}
      </Text>
      {total ? <Text variant="heading">{total}</Text> : null}
    </Pressable>
  );
}

function TimelineEntry({
  entry,
  last,
  locale,
}: {
  entry: ContactActivityResponse;
  last: boolean;
  locale: string;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={styles.entry}>
      <View style={styles.rail}>
        <View style={[styles.dot, { backgroundColor: colors.primary }]} />
        {last ? null : <View style={[styles.stem, { backgroundColor: colors.border }]} />}
      </View>
      <View style={styles.entryBody}>
        <Text variant="label">{entry.title}</Text>
        {entry.body ? <Text muted>{entry.body}</Text> : null}
        <Text variant="caption" muted>
          {joinMeta([typeLabel(entry.activityType, t), formatMoment(entry.occurredAt, locale)])}
        </Text>
        {entry.source === 'user' ? null : (
          <Badge label={t(`contactNotes.activity.source.${entry.source}`)} />
        )}
      </View>
    </View>
  );
}

type Field = 'type' | 'title' | 'details';
type FieldErrors = Partial<Record<Field, string>>;

/** The form's field for each property of the API's body. */
const FIELD_OF: Record<string, Field> = { activityType: 'type', title: 'title', body: 'details' };

function AddActivityModal({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const create = useCreateActivity(contactId);
  const [type, setType] = useState(DEFAULT_TYPE);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  const message = (field: Field) => t(`contactNotes.activity.form.${field}Invalid`);

  const submit = () => {
    if (create.isPending) return;
    setFailure(null);
    const body = details.trim();
    const parsed = createContactActivitySchema.safeParse({
      activityType: type.trim(),
      title: title.trim(),
      ...(body ? { body } : {}),
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = FIELD_OF[String(issue.path[0])];
        if (field) next[field] = message(field);
      }
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: onClose,
      onError: (error) => {
        const named: FieldErrors = {};
        if (isApiError(error)) {
          for (const detail of error.fieldErrors) {
            const field = FIELD_OF[detail.path];
            if (field) named[field] = message(field);
          }
        }
        if (Object.keys(named).length > 0) setErrors(named);
        else setFailure(messageForError(error, t));
      },
    });
  };

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <View style={[styles.scrim, { backgroundColor: colors.scrim }]}>
          <View
            accessibilityViewIsModal
            style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text variant="heading" accessibilityRole="header">
              {t('contactNotes.activity.form.title')}
            </Text>
            <ScrollView
              contentContainerStyle={styles.sheetBody}
              keyboardShouldPersistTaps="handled"
            >
              {failure ? <Banner tone="danger" message={failure} /> : null}
              <TextField
                label={t('contactNotes.activity.form.type')}
                hint={t('contactNotes.activity.form.typeHint')}
                value={type}
                onChangeText={setType}
                error={errors.type}
                maxLength={100}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
              <TextField
                label={t('contactNotes.activity.form.name')}
                value={title}
                onChangeText={setTitle}
                error={errors.title}
                maxLength={255}
                returnKeyType="next"
              />
              <TextField
                label={t('contactNotes.activity.form.details')}
                value={details}
                onChangeText={setDetails}
                error={errors.details}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                maxLength={10_000}
              />
            </ScrollView>
            <View style={styles.actions}>
              <Button
                label={t('contactNotes.activity.form.save')}
                loading={create.isPending}
                onPress={submit}
              />
              <Button variant="link" label={t('contactNotes.cancel')} onPress={onClose} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * The Activity tab of a contact: a tile for the notes (it opens them) and one for the tasks, then the timeline of what happened
 * with this contact, newest first, with a "Load more" button (the tab sits inside the contact's own scroll view, so it does not
 * scroll a list of its own). People who may update contacts can log an entry of their own.
 *
 * The API has no totals: the notes tile counts what has been loaded ("20+" when there are more) and the tasks tile, which shows
 * only to people who may read tasks, has no number.
 */
export function ActivityTab({ contactId, canUpdate, hideTiles }: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const session = useSession();
  const canRead = can(session.data, 'record.contacts.read');
  const canReadTasks = can(session.data, 'record.tasks.read');
  const notes = useContactNotes(contactId, canRead);
  const activities = useContactActivities(contactId, canRead);
  const [adding, setAdding] = useState(false);

  const entries = useMemo(
    () => activities.data?.pages.flatMap((page) => page.data) ?? [],
    [activities.data],
  );
  const noteCount = notes.data?.pages.reduce((sum, page) => sum + page.data.length, 0);
  const notesTotal = noteCount === undefined ? null : `${noteCount}${notes.hasNextPage ? '+' : ''}`;
  const locale = i18n.language;

  let timeline;
  if (!canRead) {
    timeline = null;
  } else if (activities.isPending) {
    timeline = (
      <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />
    );
  } else if (activities.isError && entries.length === 0) {
    timeline =
      failureKindOf(activities.error) === 'other' ? (
        <ErrorCard error={activities.error} onRetry={() => void activities.refetch()} />
      ) : null;
  } else if (entries.length === 0) {
    timeline = <EmptyState icon="time-outline" title={t('contactNotes.activity.empty')} />;
  } else {
    timeline = (
      <View>
        {entries.map((entry, index) => (
          <TimelineEntry
            key={entry.id}
            entry={entry}
            last={index === entries.length - 1 && !activities.hasNextPage}
            locale={locale}
          />
        ))}
        {activities.hasNextPage ? (
          <Button
            variant="secondary"
            label={t('contactNotes.loadMore')}
            loading={activities.isFetchingNextPage}
            onPress={() => void activities.fetchNextPage()}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {hideTiles ? null : (
        <View style={styles.tiles}>
          <Tile
            icon="document-text-outline"
            label={t('contactNotes.activity.notes')}
            total={notesTotal}
            onPress={() => router.push({ pathname: '/contact-notes', params: { contactId } })}
          />
          {canReadTasks ? (
            <Tile
              icon="checkbox-outline"
              label={t('contactNotes.activity.tasks')}
              total={null}
              // The Tasks screen is its own feature and registers its own route; typed routes do not know it yet.
              onPress={() =>
                router.push({ pathname: '/tasks', params: { contactId } } as unknown as Href)
              }
            />
          ) : null}
        </View>
      )}

      <Text variant="subheading" accessibilityRole="header">
        {t('contactNotes.activity.timeline')}
      </Text>
      {canUpdate ? (
        <Button
          variant="secondary"
          label={t('contactNotes.activity.add')}
          onPress={() => setAdding(true)}
        />
      ) : null}
      {timeline}

      {adding ? <AddActivityModal contactId={contactId} onClose={() => setAdding(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  root: { gap: spacing.lg },
  loading: { marginVertical: spacing.xl },
  tiles: { flexDirection: 'row', gap: spacing.md },
  tile: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET * 2,
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entry: { flexDirection: 'row', gap: spacing.md },
  rail: { width: 12, alignItems: 'center', paddingTop: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  stem: { flex: 1, width: 2, marginTop: spacing.xs },
  entryBody: { flex: 1, gap: spacing.xs, paddingBottom: spacing.lg },
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  sheetBody: { gap: spacing.lg },
  actions: { gap: spacing.sm },
});
