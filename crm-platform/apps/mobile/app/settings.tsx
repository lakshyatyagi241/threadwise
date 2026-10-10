import { FlatList, Switch, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../src/api';
import { useTheme } from '../src/theme';
import { Load, Row } from '../src/ui';

type Pref = { type: string; group: string; push: boolean };

export default function Settings() {
  const t = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['prefs'], queryFn: () => api<{ items: Pref[] }>('/notifications/preferences') });
  const set = useMutation({
    mutationFn: (v: { type: string; push: boolean }) => api('/notifications/preferences', { method: 'PUT', body: { items: [v] } }),
    onSuccess: (d) => qc.setQueryData(['prefs'], d),
  });
  const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Load q={q}>
        {(d) => (
          <FlatList
            data={d.items}
            keyExtractor={(p) => p.type}
            renderItem={({ item: p }) => (
              <Row title={label(p.type)} sub={`Push · ${label(p.group)}`} right={<Switch value={p.push} onValueChange={(v) => set.mutate({ type: p.type, push: v })} trackColor={{ true: t.primary }} />} />
            )}
          />
        )}
      </Load>
    </View>
  );
}
