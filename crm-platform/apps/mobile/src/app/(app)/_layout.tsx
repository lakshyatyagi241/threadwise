import { Stack } from 'expo-router';

/** The signed-in app: the four tabs, with the thread and contact screens on top of them. */
export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
