import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../src/api';
import { useTheme } from '../src/theme';
import { Empty, Load, Pill, Row } from '../src/ui';

type Task = { id: string; title: string; priority: 'low' | 'medium' | 'high'; status: 'open' | 'done'; dueAt: string | null; overdue: boolean };

export default function Tasks() {
  const t = useTheme();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'open' | 'done'>('open');
  const q = useQuery({ queryKey: ['tasks', status], queryFn: () => api<{ data: Task[] }>('/tasks/my', { query: { status, limit: 100 } }) });
  const toggle = useMutation({
    mutationFn: (k: Task) => api(`/tasks/${k.id}/${k.status === 'open' ? 'complete' : 'reopen'}`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flexDirection: 'row', gap: 8, padding: 12 }}>
        {(['open', 'done'] as const).map((s) => (
          <Pressable key={s} onPress={() => setStatus(s)} style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 18, backgroundColor: status === s ? t.primary : t.card }}>
            <Text style={{ color: status === s ? t.onPrimary : t.text, fontWeight: '600', textTransform: 'capitalize' }}>{s}</Text>
          </Pressable>
        ))}
      </View>
      <Load q={q}>
        {(d) => (
          <FlatList
            data={d.data}
            keyExtractor={(k) => k.id}
            refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={t.primary} />}
            ListEmptyComponent={<Empty text={status === 'open' ? 'Nothing to do' : 'No completed tasks'} />}
            renderItem={({ item: k }) => (
              <Row
                onPress={() => toggle.mutate(k)}
                title={`${k.status === 'done' ? '☑' : '☐'}  ${k.title}`}
                sub={k.dueAt ? `Due ${new Date(k.dueAt).toLocaleDateString()}${k.overdue ? ' · overdue' : ''}` : undefined}
                right={<Pill text={k.priority} color={k.priority === 'high' ? t.danger : t.sub} />}
              />
            )}
          />
        )}
      </Load>
    </View>
  );
}
