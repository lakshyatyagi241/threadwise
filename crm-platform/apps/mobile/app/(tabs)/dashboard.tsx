import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/api';
import { useTheme, type Theme } from '../../src/theme';
import type { DashSummary } from '../../src/types';

const RANGES = ['24h', '7d', '30d'] as const;

export default function Dashboard() {
  const t = useTheme();
  const [range, setRange] = useState<(typeof RANGES)[number]>('7d');
  const q = useQuery({ queryKey: ['dash', range], queryFn: () => api<DashSummary>('/dashboard/summary', { query: { range } }), refetchInterval: 30000 });
  const d = q.data;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 12 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={t.primary} />}>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        {RANGES.map((r) => (
          <Pressable key={r} onPress={() => setRange(r)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: range === r ? t.primary : t.card }}>
            <Text style={{ color: range === r ? t.onPrimary : t.text, fontWeight: '600' }}>{r}</Text>
          </Pressable>
        ))}
      </View>
      {q.isLoading ? (
        <ActivityIndicator color={t.primary} style={{ marginTop: 40 }} />
      ) : q.isError || !d ? (
        <Text style={{ color: t.danger }}>{(q.error as Error)?.message ?? 'Could not load'}</Text>
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <Kpi t={t} label="Sent" value={d.current.sent} sub={`${d.sentDeltaPct >= 0 ? '+' : ''}${d.sentDeltaPct}%`} />
            <Kpi t={t} label="Delivered" value={d.current.delivered} />
            <Kpi t={t} label="Read" value={d.current.read} />
            <Kpi t={t} label="Failed" value={d.current.failed} bad />
            <Kpi t={t} label="Replies" value={d.current.replies} />
            <Kpi t={t} label="Contacts messaged" value={d.current.contactsMessaged} />
          </View>

          <Text style={{ color: t.text, fontWeight: '700', fontSize: 16, marginTop: 20, marginBottom: 8 }}>Sent, last 20 hours</Text>
          <View style={{ backgroundColor: t.card, borderRadius: 14, padding: 14, height: 110, flexDirection: 'row', alignItems: 'flex-end', gap: 3 }}>
            {d.sparkline.map((n, i) => (
              <View key={i} style={{ flex: 1, height: `${Math.max(4, (n / Math.max(...d.sparkline, 1)) * 100)}%`, backgroundColor: t.primary, borderRadius: 3 }} />
            ))}
          </View>

          <Text style={{ color: t.text, fontWeight: '700', fontSize: 16, marginTop: 20, marginBottom: 8 }}>Funnel · reply rate {d.funnel.replyRate}%</Text>
          <View style={{ backgroundColor: t.card, borderRadius: 14, padding: 14, gap: 10 }}>
            {d.funnel.stages.map((s) => (
              <View key={s.key}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: t.text, textTransform: 'capitalize' }}>{s.key}</Text>
                  <Text style={{ color: t.sub }}>{s.count} · {s.pct}%</Text>
                </View>
                <View style={{ height: 6, backgroundColor: t.line, borderRadius: 3, marginTop: 4 }}>
                  <View style={{ width: `${Math.min(100, s.pct)}%`, height: 6, backgroundColor: t.primary, borderRadius: 3 }} />
                </View>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Kpi({ t, label, value, sub, bad }: { t: Theme; label: string; value: number; sub?: string; bad?: boolean }) {
  return (
    <View style={{ width: '48%', backgroundColor: t.card, borderRadius: 14, padding: 14 }}>
      <Text style={{ color: t.sub, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: bad && value > 0 ? t.danger : t.text, fontSize: 26, fontWeight: '800', marginTop: 4 }}>{value}</Text>
      {!!sub && <Text style={{ color: t.sub, fontSize: 12, marginTop: 2 }}>{sub}</Text>}
    </View>
  );
}
