// Images the app imports (`import logo from '@/assets/images/logo.png'`) are React Native image sources.
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';
  const source: ImageSourcePropType;
  export default source;
}
