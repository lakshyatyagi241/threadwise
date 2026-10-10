import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/api';
import { useTheme } from '../../src/theme';
import { Load } from '../../src/ui';
import type { Contact } from '../../src/types';

type Detail = Contact & { firstName: string | null; lastName: string | null; source: string | null; createdAt: string; lifecycleState: string };

export default function ContactDetail() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['contact', id], queryFn: () => api<Detail>(`/contacts/${id}`) });

  // Opens the thread for this contact, creating it on the first connected WhatsApp number when there is none yet.
  const message = async (c: Detail) => {
    try {
      const chans = await api<{ data: { id: string; kind: string; status: string }[] }>('/channels');
      const ch = chans.data.find((x) => x.status === 'connected' && x.kind.startsWith('whatsapp')) ?? chans.data.find((x) => x.status === 'connected');
      if (!ch) return Alert.alert('No channel', 'Connect a WhatsApp number in the web app first.');
      const r = await api<{ id: string }>('/inbox/conversations/open', { method: 'POST', body: { contactId: c.id, channelId: ch.id } });
      router.push({ pathname: '/chat/[id]', params: { id: r.id, title: c.name ?? c.phone ?? '' } });
    } catch (e) {
      Alert.alert('Could not open chat', (e as Error).message);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 16 }}>
      <Stack.Screen options={{ title: q.data?.name ?? 'Contact' }} />
      <Load q={q}>
        {(c) => (
          <>
            <View style={{ alignItems: 'center', marginVertical: 12 }}>
              <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: t.onPrimary, fontSize: 32, fontWeight: '700' }}>{(c.name || c.phone || '?').trim().charAt(0).toUpperCase()}</Text>
              </View>
              <Text style={{ color: t.text, fontSize: 22, fontWeight: '800', marginTop: 10 }}>{c.name || c.phone || 'Unnamed'}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
              <Action t={t} label="Message" onPress={() => message(c)} />
              {!!c.phone && <Action t={t} label="Call" onPress={() => Linking.openURL(`tel:${c.phone}`)} />}
              {!!c.email && <Action t={t} label="Email" onPress={() => Linking.openURL(`mailto:${c.email}`)} />}
            </View>
            <View style={{ backgroundColor: t.card, borderRadius: 14, padding: 14, gap: 12 }}>
              {([['Phone', c.phone], ['Email', c.email], ['Stage', c.lifecycleStage], ['Status', c.status], ['Source', c.source], ['Added', c.createdAt ? new Date(c.createdAt).toLocaleDateString() : null]] as const)
                .filter(([, v]) => !!v)
                .map(([k, v]) => (
                  <View key={k}>
                    <Text style={{ color: t.sub, fontSize: 12 }}>{k}</Text>
                    <Text style={{ color: t.text, fontSize: 16 }}>{v}</Text>
                  </View>
                ))}
            </View>
          </>
        )}
      </Load>
    </ScrollView>
  );
}

const Action = ({ t, label, onPress }: { t: ReturnType<typeof useTheme>; label: string; onPress: () => void }) => (
  <Pressable onPress={onPress} style={{ flex: 1, backgroundColor: t.card, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}>
    <Text style={{ color: t.primary, fontWeight: '700' }}>{label}</Text>
  </Pressable>
);
