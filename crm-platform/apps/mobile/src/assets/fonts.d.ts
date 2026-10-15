// Fonts the app imports (`import regular from '@/assets/fonts/Inter-Regular.ttf'`) are sources for expo-font.
declare module '*.ttf' {
  import type { FontSource } from 'expo-font';
  const source: FontSource;
  export default source;
}
