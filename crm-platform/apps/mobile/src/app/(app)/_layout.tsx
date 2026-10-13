import { Stack } from 'expo-router';
import { ThemeSync } from '@/features/menu/theme-sync';

/** The signed-in app: the four tabs, with the thread and contact screens on top of them. */
export default function AppLayout() {
  return (
    <>
      <ThemeSync />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
