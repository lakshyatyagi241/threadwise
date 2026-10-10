import { useState } from 'react';
import { FlatList, RefreshControl, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../src/api';
import { useTheme } from '../src/theme';
import { Empty, Load, Pill, Row } from '../src/ui';

type Tpl = { id: string; name: string; language: string; metaCategory: string; status: string; body: string };

export default function Templates() {
  const t = useTheme();
  const [s, setS] = useState('');
  const q = useQuery({ queryKey: ['templates'], queryFn: () => api<{ data: Tpl[] }>('/templates', { query: { limit: 100 } }) });
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TextInput value={s} onChangeText={setS} placeholder="Search templates" placeholderTextColor={t.sub} style={{ margin: 12, backgroundColor: t.card, color: t.text, borderRadius: 12, padding: 11, fontSize: 15 }} />
      <Load q={q}>
        {(d) => (
          <FlatList
            data={d.data.filter((x) => x.name.toLowerCase().includes(s.trim().toLowerCase()))}
            keyExtractor={(x) => x.id}
            refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={t.primary} />}
            ListEmptyComponent={<Empty text="No templates" />}
            renderItem={({ item: x }) => (
              <Row title={`${x.name} · ${x.language}`} sub={x.body} right={<Pill text={x.status} color={x.status === 'approved' ? t.primary : x.status === 'rejected' ? t.danger : t.sub} />} />
            )}
          />
        )}
      </Load>
    </View>
  );
}
