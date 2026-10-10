import { useColorScheme } from 'react-native';

const light = {
  bg: '#F4F6F8', card: '#FFFFFF', text: '#111B21', sub: '#667781', line: '#E4E8EB',
  primary: '#128C7E', onPrimary: '#FFFFFF', bubbleIn: '#FFFFFF', bubbleOut: '#D9FDD3',
  danger: '#D93025', badge: '#25D366',
};
const dark: typeof light = {
  bg: '#0B141A', card: '#111B21', text: '#E9EDEF', sub: '#8696A0', line: '#222D34',
  primary: '#00A884', onPrimary: '#FFFFFF', bubbleIn: '#202C33', bubbleOut: '#005C4B',
  danger: '#F28B82', badge: '#00A884',
};

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);
