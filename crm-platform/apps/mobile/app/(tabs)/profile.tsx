import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useTheme } from '../../src/theme';

type SessionInfo = { user?: { fullName?: string | null; displayName?: string | null; email?: string }; org?: { name?: string } };

export default function Profile() {
  const t = useTheme();
  const router = useRouter();
  const { session, signOut } = useAuth();
  const info = useQuery({ queryKey: ['session'], queryFn: () => api<SessionInfo>('/auth/session') });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 20 }}>
      <View style={{ backgroundColor: t.card, borderRadius: 14, padding: 18 }}>
        <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>{info.data?.user?.displayName ?? info.data?.user?.fullName ?? info.data?.user?.email ?? 'Signed in'}</Text>
        {!!info.data?.user?.email && <Text style={{ color: t.sub, marginTop: 4 }}>{info.data.user.email}</Text>}
        <Text style={{ color: t.sub, marginTop: 4 }}>Workspace: {session?.orgSlug}</Text>
      </View>
      <View style={{ backgroundColor: t.card, borderRadius: 14, marginTop: 20, overflow: 'hidden' }}>
        {([['Campaigns', '/campaigns'], ['Templates', '/templates'], ['Deals', '/deals'], ['Tasks', '/tasks'], ['Notifications', '/notifications'], ['Notification settings', '/settings']] as const).map(([label, href]) => (
          <Pressable key={href} onPress={() => router.push(href)} style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', borderBottomColor: t.line, borderBottomWidth: 1 }}>
            <Text style={{ color: t.text, fontSize: 16 }}>{label}</Text>
            <Text style={{ color: t.sub }}>›</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        onPress={() => Alert.alert('Sign out', 'Sign out of Reference?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: signOut }])}
        style={{ marginTop: 20, backgroundColor: t.card, borderRadius: 14, padding: 16, alignItems: 'center' }}
      >
        <Text style={{ color: t.danger, fontWeight: '700', fontSize: 16 }}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}
