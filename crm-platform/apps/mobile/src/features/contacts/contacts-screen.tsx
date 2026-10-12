import type { ContactResponse } from '@crm/contracts';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { HeaderIconButton, ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import type { ContactFilters } from './api';
import { ContactActionsSheet } from './contact-actions-sheet';
import { displayName } from './contact-display';
import { ContactRow } from './contact-row';
import { ContactSkeleton } from './contact-skeleton';
import { FilterModal } from './filter-modal';
import { NO_FILTERS, activeFilterCount, cleanFilters } from './filters';
import { useContactList, useDebounced, useDeleteContact } from './use-contacts';
import { ViewsDrawer } from './views-drawer';
import { ALL_CONTACTS, isAllContacts, viewFilters, type ChosenView } from './views';

/** How long the search waits for the person to stop typing before it asks the API. */
export const SEARCH_DEBOUNCE_MS = 300;

const FAB_SIZE = 52;
const FAB_MARGIN = 24;

/**
 * The Contacts tab: every contact of the workspace, newest first, a page of 50 at a time. Search (words match the name, email or
 * phone) and a filter sheet narrow it; a row opens the contact; the round button adds one. Without the permission to read
 * contacts the screen says so and asks the API for nothing.
 */
export function ContactsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const session = useSession();
  const allowed = can(session.data, 'record.contacts.read');
  const canCreate = can(session.data, 'record.contacts.create');

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<ContactFilters>(NO_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [view, setView] = useState<ChosenView>(ALL_CONTACTS);
  const [viewsOpen, setViewsOpen] = useState(false);
  const viewName = view.kind === 'custom' ? view.name : t(`contacts.views.system.${view.id}`);
  const [refreshing, setRefreshing] = useState(false);

  const q = useDebounced(searchText.trim(), SEARCH_DEBOUNCE_MS);
  const userId = session.data?.user.id;
  const queryFilters = useMemo(
    () => cleanFilters({ ...viewFilters(view, userId), ...cleanFilters(filters), q }),
    [view, userId, filters, q],
  );
  const list = useContactList(queryFilters, allowed);
  const contacts = useMemo(() => list.data?.pages.flatMap((page) => page.data) ?? [], [list.data]);
  const narrowed =
    activeFilterCount(filters) > 0 || queryFilters.q !== undefined || !isAllContacts(view);

  const [sheetFor, setSheetFor] = useState<ContactResponse | null>(null);
  const [deleting, setDeleting] = useState<ContactResponse | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const remove = useDeleteContact(deleting?.id ?? '');

  const open = useCallback(
    (id: string) => router.push({ pathname: '/contact/[id]', params: { id } }),
    [router],
  );
  const refresh = async () => {
    setRefreshing(true);
    await list.refetch();
    setRefreshing(false);
  };

  const toggleSearch = () => {
    if (searchOpen) setSearchText('');
    setSearchOpen(!searchOpen);
  };

  let body;
  if (session.data === undefined) {
    body = session.isError ? (
      <ErrorCard error={session.error} onRetry={() => void session.refetch()} />
    ) : (
      <ContactSkeleton />
    );
  } else if (!allowed) {
    body = (
      <EmptyState
        icon="lock-closed-outline"
        title={t('contacts.denied.title')}
        hint={t('contacts.denied.hint')}
      />
    );
  } else if (list.isPending) {
    body = <ContactSkeleton />;
  } else if (list.isError && contacts.length === 0) {
    body = <ErrorCard error={list.error} onRetry={() => void list.refetch()} />;
  } else {
    body = (
      <FlatList
        testID="contacts-list"
        data={contacts}
        keyExtractor={(contact) => contact.id}
        renderItem={({ item }) => <ContactRow contact={item} onPress={open} onMore={setSheetFor} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title={narrowed ? t('contacts.empty.filteredTitle') : t('contacts.empty.title')}
            hint={narrowed ? t('contacts.empty.filteredHint') : t('contacts.empty.hint')}
          />
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.footer} />
          ) : null
        }
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <ScreenHeader
        actions={
          <>
            <HeaderIconButton
              icon={searchOpen ? 'close' : 'search-outline'}
              label={searchOpen ? t('contacts.search.close') : t('contacts.search.open')}
              onPress={toggleSearch}
            />
            <HeaderIconButton
              icon={{ material: 'filter-list' }}
              label={t('contacts.filter.open')}
              dot={activeFilterCount(filters) > 0}
              onPress={() => setFilterOpen(true)}
            />
          </>
        }
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('contacts.views.open', { name: viewName })}
          accessibilityState={{ expanded: viewsOpen }}
          onPress={() => setViewsOpen(true)}
          style={styles.viewTitle}
        >
          <Text variant="heading" numberOfLines={1} style={styles.viewName}>
            {viewName}
          </Text>
          <Icon name="chevron-down" size={16} color="textMuted" />
        </Pressable>
      </ScreenHeader>

      {searchOpen ? (
        <View style={styles.search}>
          <TextField
            label={t('contacts.search.label')}
            placeholder={t('contacts.search.placeholder')}
            value={searchText}
            onChangeText={setSearchText}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
      ) : null}

      {deleteError ? (
        <View style={styles.search}>
          <Banner tone="danger" message={deleteError} />
        </View>
      ) : null}

      <View style={styles.fill}>{body}</View>

      {allowed && canCreate ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('contacts.add')}
          onPress={() => router.push('/contact/new')}
          style={[styles.fab, { backgroundColor: colors.primary, shadowColor: colors.shadow }]}
        >
          <Icon name="add" size={24} color="onPrimary" />
        </Pressable>
      ) : null}

      {filterOpen ? (
        <FilterModal
          filters={filters}
          onClose={() => setFilterOpen(false)}
          onApply={(next) => {
            setFilters(next);
            setFilterOpen(false);
          }}
        />
      ) : null}
      {viewsOpen ? (
        <ViewsDrawer
          chosen={view}
          canReadSaved={can(session.data, 'record.contact-views.read')}
          onClose={() => setViewsOpen(false)}
          onChoose={(next) => {
            setView(next);
            setViewsOpen(false);
          }}
        />
      ) : null}

      <ContactActionsSheet
        contact={sheetFor}
        onClose={() => setSheetFor(null)}
        onEdit={(contact) => {
          setSheetFor(null);
          router.push({ pathname: '/contact/[id]', params: { id: contact.id, edit: '1' } });
        }}
        onDelete={(contact) => {
          setSheetFor(null);
          setDeleteError(null);
          setDeleting(contact);
        }}
      />
      <ConfirmDialog
        visible={deleting !== null}
        title={t('contacts.detail.delete.title')}
        message={t('contacts.detail.delete.message', {
          name: deleting ? displayName(deleting, t) : '',
        })}
        confirmLabel={t('contacts.detail.delete.confirm')}
        cancelLabel={t('contacts.detail.delete.cancel')}
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => setDeleting(null),
            onError: (error) => {
              setDeleting(null);
              setDeleteError(messageForError(error, t));
            },
          })
        }
      />
    </View>
  );
}

function ErrorCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.error}>
      <Card>
        <Text danger accessibilityRole="alert">
          {messageForError(error, t)}
        </Text>
        <Button variant="secondary" label={t('common.retry')} onPress={onRetry} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  viewTitle: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
  },
  viewName: { flexShrink: 1 },
  fill: { flex: 1 },
  search: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  error: { padding: spacing.lg },
  footer: { paddingVertical: spacing.lg },
  // Room under the last row for the round button, so it never covers a contact.
  listContent: { flexGrow: 1, paddingBottom: FAB_SIZE + FAB_MARGIN * 2 },
  fab: {
    position: 'absolute',
    right: FAB_MARGIN,
    bottom: FAB_MARGIN,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});
