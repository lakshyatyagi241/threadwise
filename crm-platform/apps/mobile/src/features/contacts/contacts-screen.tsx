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
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { HeaderIconButton, ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import type { ContactFilters } from './api';
import { ContactRow } from './contact-row';
import { ContactSkeleton } from './contact-skeleton';
import { FilterModal } from './filter-modal';
import { NO_FILTERS, activeFilterCount, cleanFilters } from './filters';
import { useContactList, useDebounced } from './use-contacts';

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
  const [refreshing, setRefreshing] = useState(false);

  const q = useDebounced(searchText.trim(), SEARCH_DEBOUNCE_MS);
  const queryFilters = useMemo(() => cleanFilters({ ...filters, q }), [filters, q]);
  const list = useContactList(queryFilters, allowed);
  const contacts = useMemo(() => list.data?.pages.flatMap((page) => page.data) ?? [], [list.data]);
  const narrowed = activeFilterCount(filters) > 0 || queryFilters.q !== undefined;

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
        renderItem={({ item }) => <ContactRow contact={item} onPress={open} />}
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
        <Text variant="heading" accessibilityRole="header">
          {t('contacts.title')}
        </Text>
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
