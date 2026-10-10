import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from '../src/auth';
import { useTheme } from '../src/theme';
import { RealtimeProvider } from '../src/realtime';
import { usePush } from '../src/push';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });

function Gate() {
  const { ready, session } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const t = useTheme();
  usePush();

  useEffect(() => {
    if (!ready) return;
    const onLogin = segments[0] === 'login';
    if (!session && !onLogin) router.replace('/login');
    else if (session && onLogin) router.replace('/');
  }, [ready, session, segments]);

  if (!ready)
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: t.bg }}>
        <ActivityIndicator color={t.primary} />
      </View>
    );
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: t.card }, headerTintColor: t.text, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
      <Stack.Screen name="contact/[id]" options={{ title: 'Contact' }} />
      <Stack.Screen name="contact/new" options={{ title: 'New contact' }} />
      <Stack.Screen name="campaigns" options={{ title: 'Campaigns' }} />
      <Stack.Screen name="templates" options={{ title: 'Templates' }} />
      <Stack.Screen name="deals" options={{ title: 'Deals' }} />
      <Stack.Screen name="tasks" options={{ title: 'Tasks' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="settings" options={{ title: 'Notification settings' }} />
    </Stack>
  );
}

export default function Root() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <StatusBar style="auto" />
        <RealtimeProvider>
          <Gate />
        </RealtimeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
