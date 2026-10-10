import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTheme } from './theme';

/** Loading / error wrapper so each screen only renders the happy path. */
export function Load<T>({ q, children }: { q: Pick<UseQueryResult<T>, 'isLoading' | 'isError' | 'error' | 'data'>; children: (d: T) => ReactNode }) {
  const t = useTheme();
  if (q.isLoading) return <ActivityIndicator color={t.primary} style={{ marginTop: 40 }} />;
  if (q.isError || q.data === undefined) return <Text style={{ color: t.danger, padding: 20 }}>{(q.error as Error)?.message ?? 'Could not load'}</Text>;
  return <>{children(q.data)}</>;
}

export function Row({ title, sub, right, onPress }: { title: string; sub?: string; right?: ReactNode; onPress?: () => void }) {
  const t = useTheme();
  const Wrap: any = onPress ? Pressable : View;
  return (
    <Wrap onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: t.card, borderBottomColor: t.line, borderBottomWidth: 1 }}>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: t.text, fontWeight: '600', fontSize: 16 }}>{title}</Text>
        {!!sub && <Text numberOfLines={2} style={{ color: t.sub, marginTop: 2 }}>{sub}</Text>}
      </View>
      {right}
    </Wrap>
  );
}

export function Pill({ text, color }: { text: string; color?: string }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: (color ?? t.primary) + '22', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10, marginLeft: 8 }}>
      <Text style={{ color: color ?? t.primary, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }}>{text}</Text>
    </View>
  );
}

export const Empty = ({ text }: { text: string }) => {
  const t = useTheme();
  return <Text style={{ color: t.sub, textAlign: 'center', marginTop: 60 }}>{text}</Text>;
};
