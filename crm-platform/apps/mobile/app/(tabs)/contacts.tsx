import { useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api } from '../../src/api';
import { useTheme } from '../../src/theme';
import type { ContactList } from '../../src/types';

export default function Contacts() {
  const t = useTheme();
  const router = useRouter();
  const [q, setQ] = useState('');
  const list = useInfiniteQuery({
    queryKey: ['contacts', q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<ContactList>('/contacts', { query: { q: q.trim() || undefined, cursor: pageParam, limit: 40 } }),
    getNextPageParam: (p) => (p.page.hasMore ? p.page.nextCursor ?? undefined : undefined),
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TextInput value={q} onChangeText={setQ} placeholder="Search name, email or phone" placeholderTextColor={t.sub}
        style={{ margin: 12, backgroundColor: t.card, color: t.text, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 }} />
      <Pressable onPress={() => router.push('/contact/new')} style={{ position: 'absolute', right: 18, bottom: 18, zIndex: 5, width: 56, height: 56, borderRadius: 28, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', elevation: 4 }}>
        <Text style={{ color: t.onPrimary, fontSize: 30, marginTop: -2 }}>+</Text>
      </Pressable>
      {list.isLoading ? (
        <ActivityIndicator color={t.primary} style={{ marginTop: 40 }} />
      ) : list.isError ? (
        <Text style={{ color: t.danger, padding: 20 }}>{(list.error as Error).message}</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(c) => c.id}
          onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
          refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => list.refetch()} tintColor={t.primary} />}
          ListEmptyComponent={<Text style={{ color: t.sub, textAlign: 'center', marginTop: 60 }}>No contacts</Text>}
          renderItem={({ item: c }) => (
            <Pressable onPress={() => router.push({ pathname: '/contact/[id]', params: { id: c.id } })} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: t.card, borderBottomColor: t.line, borderBottomWidth: 1 }}>
              <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Text style={{ color: t.onPrimary, fontWeight: '700', fontSize: 17 }}>{(c.name || c.phone || '?').trim().charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: t.text, fontWeight: '600', fontSize: 16 }}>{c.name || c.phone || 'Unnamed'}</Text>
                <Text numberOfLines={1} style={{ color: t.sub, marginTop: 2 }}>{[c.phone, c.email].filter(Boolean).join('  ·  ')}</Text>
              </View>
              {!!c.phone && (
                <Pressable onPress={() => Linking.openURL(`tel:${c.phone}`)} hitSlop={10}>
                  <Text style={{ color: t.primary, fontWeight: '700' }}>Call</Text>
                </Pressable>
              )}
            </Pressable>
          )}
          ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.primary} style={{ margin: 16 }} /> : null}
        />
      )}
    </View>
  );
}
