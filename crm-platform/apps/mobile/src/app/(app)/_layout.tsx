import { Stack } from 'expo-router';
import { useCallReturn } from '@/features/contacts/use-call-return';
import { ThemeSync } from '@/features/menu/theme-sync';

/**
 * A screen opened directly (a link, a notification, a reload) is placed on top of the tabs, not alone in the stack. Alone, it has
 * nothing under it and the phone's Back button closes the whole app instead of going to the tab it belongs to.
 */
export const unstable_settings = { anchor: '(tabs)' };

/** The signed-in app: the four tabs, with the thread and contact screens on top of them. */
export default function AppLayout() {
  useCallReturn();
  return (
    <>
      <ThemeSync />
      <Stack screenOptions={{ headerShown: false }}>
        {/* Listed first: the first screen declared here is the one the stack starts on, and it must be the tabs. */}
        <Stack.Screen name="(tabs)" />
        {/* The "log this call" sheet slides up over whatever is on screen, so the person is not taken away from it. */}
        <Stack.Screen
          name="call-summary"
          options={{ presentation: 'transparentModal', animation: 'slide_from_bottom' }}
        />
      </Stack>
    </>
  );
}
