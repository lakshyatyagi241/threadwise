import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/api';
import { useTheme } from '../../src/theme';

export default function NewContact() {
  const t = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', phone: '', email: '' });
  const save = useMutation({
    mutationFn: () => api<{ id: string }>('/contacts', { method: 'POST', body: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)) }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      router.replace({ pathname: '/contact/[id]', params: { id: c.id } });
    },
    onError: (e) => Alert.alert('Could not save', (e as Error).message),
  });
  const input = { backgroundColor: t.card, color: t.text, borderRadius: 12, padding: 13, fontSize: 16, marginBottom: 12 } as const;
  const can = (f.phone.trim() || f.email.trim()) && !save.isPending;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <TextInput style={input} placeholder="Name" placeholderTextColor={t.sub} value={f.name} onChangeText={(v) => setF({ ...f, name: v })} />
        <TextInput style={input} placeholder="Phone (+91…)" placeholderTextColor={t.sub} keyboardType="phone-pad" value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} />
        <TextInput style={input} placeholder="Email" placeholderTextColor={t.sub} autoCapitalize="none" keyboardType="email-address" value={f.email} onChangeText={(v) => setF({ ...f, email: v })} />
        <Text style={{ color: t.sub, fontSize: 12, marginBottom: 14 }}>A phone number or an email is required.</Text>
        <Pressable disabled={!can} onPress={() => save.mutate()} style={{ backgroundColor: t.primary, opacity: can ? 1 : 0.5, borderRadius: 12, padding: 14, alignItems: 'center' }}>
          {save.isPending ? <ActivityIndicator color={t.onPrimary} /> : <Text style={{ color: t.onPrimary, fontWeight: '700', fontSize: 16 }}>Save contact</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
