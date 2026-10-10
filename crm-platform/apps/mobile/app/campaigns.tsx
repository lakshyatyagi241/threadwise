import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../src/api';
import { useTheme } from '../src/theme';
import { Empty, Load, Pill, Row } from '../src/ui';

type Campaign = { id: string; name: string; status: string; templateName: string | null; counts: Record<'recipients' | 'sent' | 'delivered' | 'read' | 'replies' | 'failed', number> };

export default function Campaigns() {
  const t = useTheme();
  const q = useQuery({ queryKey: ['campaigns'], queryFn: () => api<{ data: Campaign[] }>('/campaigns', { query: { limit: 50 } }) });
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Load q={q}>
        {(d) => (
          <FlatList
            data={d.data}
            keyExtractor={(c) => c.id}
            refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={t.primary} />}
            ListEmptyComponent={<Empty text="No campaigns" />}
            renderItem={({ item: c }) => (
              <Row
                title={c.name}
                sub={`${c.templateName ?? 'Campaign'} · ${c.counts.recipients} recipients · ${c.counts.sent} sent · ${c.counts.read} read · ${c.counts.replies} replies${c.counts.failed ? ` · ${c.counts.failed} failed` : ''}`}
                right={<Pill text={c.status} color={c.status === 'failed' ? t.danger : undefined} />}
              />
            )}
          />
        )}
      </Load>
    </View>
  );
}
