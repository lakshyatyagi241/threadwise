import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { api } from './api';
import { useAuth } from './auth';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

async function register() {
  if (!Device.isDevice) return; // simulators/emulators cannot receive remote push
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('default', { name: 'Messages', importance: Notifications.AndroidImportance.HIGH });
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return; // set after `eas init`; without it Expo cannot issue a token
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api('/notifications/push/mobile', { method: 'POST', body: { token: data, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
}

/** Registers this phone for push once signed in, and opens the conversation when a notification is tapped. */
export function usePush() {
  const { session } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (session) register().catch(() => {});
  }, [!!session]);

  useEffect(() => {
    const open = (url?: string) => {
      const m = /[?&]c=([0-9a-f-]{36})/i.exec(url ?? '') ?? /[?&]conversation=([0-9a-f-]{36})/i.exec(url ?? '');
      if (m) router.push({ pathname: '/chat/[id]', params: { id: m[1] } });
    };
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data?.url as string | undefined));
    Notifications.getLastNotificationResponseAsync().then((r) => r && open(r.notification.request.content.data?.url as string | undefined));
    return () => sub.remove();
  }, []);
}
