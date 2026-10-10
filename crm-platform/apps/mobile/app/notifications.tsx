import { FlatList, RefreshControl, Text, View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../src/api';
import { useTheme } from '../src/theme';
import { Empty, Load, Row } from '../src/ui';

type N = { id: string; title: string; body: string | null; readAt: string | null; createdAt: string; subject: { kind: string; id: string } | null };

export default function Notifications() {
  const t = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ data: N[] }>('/notifications', { query: { limit: 50 } }) });
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST', body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const open = (n: N) => {
    if (!n.readAt) api(`/notifications/${n.id}/read`, { method: 'POST', body: {} }).then(() => qc.invalidateQueries({ queryKey: ['notifications'] })).catch(() => {});
    if (n.subject?.kind === 'conversation') router.push({ pathname: '/chat/[id]', params: { id: n.subject.id } });
  };
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Pressable onPress={() => readAll.mutate()} style={{ padding: 12, alignItems: 'flex-end' }}>
        <Text style={{ color: t.primary, fontWeight: '700' }}>Mark all read</Text>
      </Pressable>
      <Load q={q}>
        {(d) => (
          <FlatList
            data={d.data}
            keyExtractor={(n) => n.id}
            refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={t.primary} />}
            ListEmptyComponent={<Empty text="No notifications" />}
            renderItem={({ item: n }) => (
              <Row onPress={() => open(n)} title={(n.readAt ? '' : '● ') + n.title} sub={n.body ?? undefined} right={<Text style={{ color: t.sub, fontSize: 12 }}>{new Date(n.createdAt).toLocaleDateString()}</Text>} />
            )}
          />
        )}
      </Load>
    </View>
  );
}
