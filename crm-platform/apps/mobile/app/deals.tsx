import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../src/api';
import { useTheme } from '../src/theme';
import { Empty, Load, Row } from '../src/ui';

type Deal = { id: string; title: string; value: string; currency: string; contact: { name: string | null } | null };
type Board = { pipeline: { name: string }; stages: { stage: { id: string; name: string; color: string }; count: number; deals: Deal[] }[] };

export default function Deals() {
  const t = useTheme();
  const [sel, setSel] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['deals-board'], queryFn: () => api<Board>('/deals/board') });
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Load q={q}>
        {(b) => {
          const cur = b.stages.find((s) => s.stage.id === sel) ?? b.stages[0];
          return (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 12, gap: 8 }}>
                {b.stages.map((s) => {
                  const on = s.stage.id === cur?.stage.id;
                  return (
                    <Pressable key={s.stage.id} onPress={() => setSel(s.stage.id)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: on ? s.stage.color : t.card }}>
                      <Text style={{ color: on ? '#fff' : t.text, fontWeight: '600' }}>{s.stage.name} {s.count}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <FlatList
                data={cur?.deals ?? []}
                keyExtractor={(d) => d.id}
                refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={t.primary} />}
                ListEmptyComponent={<Empty text={`No deals in ${cur?.stage.name ?? 'this stage'}`} />}
                renderItem={({ item: d }) => (
                  <Row title={d.title} sub={d.contact?.name ?? undefined} right={<Text style={{ color: t.text, fontWeight: '700' }}>{d.currency} {d.value}</Text>} />
                )}
              />
            </>
          );
        }}
      </Load>
    </View>
  );
}
