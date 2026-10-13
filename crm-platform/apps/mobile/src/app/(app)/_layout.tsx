import { Stack } from 'expo-router';
import { ThemeSync } from '@/features/menu/theme-sync';

/**
 * A screen opened directly (a link, a notification, a reload) is placed on top of the tabs, not alone in the stack. Alone, it has
 * nothing under it and the phone's Back button closes the whole app instead of going to the tab it belongs to.
 */
export const unstable_settings = { anchor: '(tabs)' };

/** The signed-in app: the four tabs, with the thread and contact screens on top of them. */
export default function AppLayout() {
  return (
    <>
      <ThemeSync />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
