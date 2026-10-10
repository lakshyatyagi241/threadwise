import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/api';
import { useTheme } from '../../src/theme';
import type { ConversationList, Tab } from '../../src/types';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'Mine' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'unread', label: 'Unread' },
];

const timeLabel = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

export default function Inbox() {
  const t = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');

  const list = useQuery({
    queryKey: ['inbox', tab, q],
    queryFn: () => api<ConversationList>('/inbox/conversations', { query: { tab, q: q.trim() || undefined, limit: 50 } }),
    refetchInterval: 30000,
  });
  const counts = list.data?.meta.counts;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search name, number or message"
        placeholderTextColor={t.sub}
        style={{ margin: 12, marginBottom: 6, backgroundColor: t.card, color: t.text, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 }}
      />
      <View style={{ flexDirection: 'row', paddingHorizontal: 12, gap: 8, paddingBottom: 8 }}>
        {TABS.map((x) => {
          const on = tab === x.key;
          const n = counts?.[x.key];
          return (
            <Pressable key={x.key} onPress={() => setTab(x.key)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: on ? t.primary : t.card }}>
              <Text style={{ color: on ? t.onPrimary : t.text, fontWeight: '600', fontSize: 13 }}>
                {x.label}{n ? ` ${n}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {list.isLoading ? (
        <ActivityIndicator color={t.primary} style={{ marginTop: 40 }} />
      ) : list.isError ? (
        <Text style={{ color: t.danger, padding: 20 }}>{(list.error as Error).message}</Text>
      ) : (
        <FlatList
          data={list.data?.data ?? []}
          keyExtractor={(c) => c.id}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => list.refetch()} tintColor={t.primary} />}
          ListEmptyComponent={<Text style={{ color: t.sub, textAlign: 'center', marginTop: 60 }}>No conversations</Text>}
          renderItem={({ item: c }) => (
            <Pressable onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.id, title: c.title } })} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: t.card, borderBottomColor: t.line, borderBottomWidth: 1 }}>
              <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Text style={{ color: t.onPrimary, fontWeight: '700', fontSize: 18 }}>{(c.title || '?').trim().charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text numberOfLines={1} style={{ color: t.text, fontWeight: c.unreadCount ? '700' : '600', fontSize: 16, flex: 1 }}>{c.title}</Text>
                  <Text style={{ color: c.unreadCount ? t.badge : t.sub, fontSize: 12, marginLeft: 8 }}>{timeLabel(c.lastMessageAt)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 }}>
                  <Text numberOfLines={1} style={{ color: t.sub, flex: 1 }}>{c.preview ?? ''}</Text>
                  {c.unreadCount > 0 && (
                    <View style={{ backgroundColor: t.badge, minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 8 }}>
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{c.unreadCount}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
