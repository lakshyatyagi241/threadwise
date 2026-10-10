import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, ScrollView, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, newId, mediaSource } from '../../src/api';
import { useTheme } from '../../src/theme';
import type { ConversationDetail, Message, MessageList, TemplateOption } from '../../src/types';
import { useRealtime } from '../../src/realtime';

const tick = (m: Message) =>
  m.status === 'failed' ? '!' : m.status === 'read' ? '✓✓' : m.status === 'delivered' ? '✓✓' : m.status === 'sent' ? '✓' : '…';

export default function Chat() {
  const t = useTheme();
  const qc = useQueryClient();
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const [text, setText] = useState('');
  const [tplOpen, setTplOpen] = useState(false);
  const { joinConversation } = useRealtime();
  useEffect(() => joinConversation(id), [id]);
  const listRef = useRef<FlatList<Message>>(null);

  const detail = useQuery({ queryKey: ['conv', id], queryFn: () => api<ConversationDetail>(`/inbox/conversations/${id}`) });
  const thread = useQuery({
    queryKey: ['thread', id],
    queryFn: async () => {
      const r = await api<MessageList>(`/inbox/conversations/${id}/messages`, { query: { limit: 100 } });
      const last = r.data[r.data.length - 1];
      if (last) api(`/inbox/conversations/${id}/read`, { method: 'POST', body: { upToSeq: last.seq } }).then(() => qc.invalidateQueries({ queryKey: ['inbox'] })).catch(() => {});
      return r;
    },
    refetchInterval: 30000, // realtime pushes updates; this is only the safety net
  });

  const send = useMutation({
    mutationFn: (body: string) => api(`/inbox/conversations/${id}/messages`, { method: 'POST', body: { kind: 'text', body, clientMessageId: newId() } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['thread', id] }),
  });

  const sendMedia = useMutation({
    mutationFn: async (asset: ImagePicker.ImagePickerAsset) => {
      const form = new FormData();
      const name = asset.fileName ?? asset.uri.split('/').pop() ?? 'upload';
      form.append('file', { uri: asset.uri, name, type: asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg') } as unknown as Blob);
      const up = await api<{ id: string }>('/inbox/media', { method: 'POST', form });
      return api(`/inbox/conversations/${id}/messages`, { method: 'POST', body: { kind: 'media', mediaId: up.id, clientMessageId: newId() } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['thread', id] }),
    onError: (e) => Alert.alert('Could not send', (e as Error).message),
  });

  const attach = () =>
    Alert.alert('Attach', undefined, [
      { text: 'Photo library', onPress: () => pick(false) },
      { text: 'Camera', onPress: () => pick(true) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  const pick = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission needed', 'Allow access in Settings to attach files.');
    const r = await (camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync)({ mediaTypes: ['images', 'videos'], quality: 0.8 });
    if (!r.canceled && r.assets[0]) sendMedia.mutate(r.assets[0]);
  };

  const messages = [...(thread.data?.data ?? [])].reverse();
  const closed = detail.data && !detail.data.window.open;

  const submit = () => {
    const body = text.trim();
    if (!body || send.isPending) return;
    setText('');
    send.mutate(body, { onError: () => setText(body) });
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90} style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ title: detail.data?.title ?? title ?? 'Chat' }} />
      {thread.isLoading ? (
        <ActivityIndicator color={t.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          ref={listRef}
          inverted
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 10 }}
          renderItem={({ item: m }) => {
            const out = m.direction === 'out';
            return (
              <View style={{ alignSelf: out ? 'flex-end' : 'flex-start', maxWidth: '82%', marginVertical: 3, backgroundColor: out ? t.bubbleOut : t.bubbleIn, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 }}>
                {!out && !!m.sender.name && <Text style={{ color: t.primary, fontSize: 12, fontWeight: '700', marginBottom: 2 }}>{m.sender.name}</Text>}
                {m.media?.mime.startsWith('image/') ? (
                  <Image source={mediaSource(m.media.url)} style={{ width: 220, height: 220, borderRadius: 10, marginBottom: m.body ? 6 : 0 }} resizeMode="cover" />
                ) : m.media ? (
                  <Text style={{ color: t.primary, fontSize: 15 }}>📎 {m.media.name ?? m.media.mime}</Text>
                ) : null}
                {(m.body || !m.media) && <Text style={{ color: t.text, fontSize: 15 }}>{m.body ?? `[${m.kind}]`}</Text>}
                <Text style={{ color: m.status === 'failed' ? t.danger : t.sub, fontSize: 11, alignSelf: 'flex-end', marginTop: 2 }}>
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {out ? `  ${tick(m)}` : ''}
                </Text>
              </View>
            );
          }}
        />
      )}
      {closed && (
        <Pressable onPress={() => setTplOpen(true)} style={{ padding: 12, backgroundColor: t.card, alignItems: 'center', borderTopColor: t.line, borderTopWidth: 1 }}>
          <Text style={{ color: t.sub, fontSize: 12 }}>24-hour window closed. Only approved templates can be sent.</Text>
          <Text style={{ color: t.primary, fontWeight: '700', marginTop: 4 }}>Send a template</Text>
        </Pressable>
      )}
      <TemplateSheet id={id} open={tplOpen} onClose={() => setTplOpen(false)} onSent={() => qc.invalidateQueries({ queryKey: ['thread', id] })} />
      {send.isError && <Text style={{ color: t.danger, paddingHorizontal: 12, paddingVertical: 4 }}>{(send.error as Error).message}</Text>}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', padding: 8, gap: 8, backgroundColor: t.card, borderTopColor: t.line, borderTopWidth: 1 }}>
        <Pressable onPress={attach} disabled={!!closed || sendMedia.isPending} style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          {sendMedia.isPending ? <ActivityIndicator color={t.primary} /> : <Ionicons name="attach" size={26} color={closed ? t.line : t.sub} />}
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message"
          placeholderTextColor={t.sub}
          multiline
          editable={!closed}
          style={{ flex: 1, maxHeight: 120, backgroundColor: t.bg, color: t.text, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 }}
        />
        <Pressable onPress={submit} disabled={!!closed} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: closed ? t.line : t.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="send" size={20} color={t.onPrimary} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function TemplateSheet({ id, open, onClose, onSent }: { id: string; open: boolean; onClose: () => void; onSent: () => void }) {
  const t = useTheme();
  const [picked, setPicked] = useState<TemplateOption | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const list = useQuery({ queryKey: ['tpl', id], enabled: open, queryFn: () => api<{ data: TemplateOption[] }>(`/inbox/conversations/${id}/templates`) });
  const send = useMutation({
    mutationFn: (tpl: TemplateOption) =>
      api(`/inbox/conversations/${id}/messages`, { method: 'POST', body: { kind: 'template', templateId: tpl.id, variables: vars, clientMessageId: newId() } }),
    onSuccess: () => {
      onSent();
      close();
    },
    onError: (e) => Alert.alert('Could not send', (e as Error).message),
  });
  const close = () => {
    setPicked(null);
    setVars({});
    onClose();
  };
  const ready = picked && picked.slots.every((sl) => (vars[sl.key] ?? '').trim());

  return (
    <Modal visible={open} animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 50 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 }}>
          <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>{picked ? picked.name : 'Choose a template'}</Text>
          <Pressable onPress={picked ? () => setPicked(null) : close}><Text style={{ color: t.primary, fontWeight: '700' }}>{picked ? 'Back' : 'Close'}</Text></Pressable>
        </View>
        {picked ? (
          <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            <View style={{ backgroundColor: t.bubbleOut, borderRadius: 12, padding: 12, marginBottom: 16 }}>
              <Text style={{ color: t.text }}>{picked.body}</Text>
            </View>
            {picked.slots.map((sl) => (
              <View key={sl.key} style={{ marginBottom: 10 }}>
                <Text style={{ color: t.sub, marginBottom: 4 }}>{sl.label}</Text>
                <TextInput value={vars[sl.key] ?? ''} onChangeText={(v) => setVars((o) => ({ ...o, [sl.key]: v }))} placeholder={sl.example ?? ''} placeholderTextColor={t.sub}
                  style={{ backgroundColor: t.card, color: t.text, borderRadius: 10, padding: 12, fontSize: 15 }} />
              </View>
            ))}
            <Pressable disabled={!ready || send.isPending} onPress={() => send.mutate(picked)} style={{ backgroundColor: t.primary, opacity: ready ? 1 : 0.5, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 }}>
              {send.isPending ? <ActivityIndicator color={t.onPrimary} /> : <Text style={{ color: t.onPrimary, fontWeight: '700' }}>Send</Text>}
            </Pressable>
          </ScrollView>
        ) : list.isLoading ? (
          <ActivityIndicator color={t.primary} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={list.data?.data ?? []}
            keyExtractor={(x) => x.id}
            ListEmptyComponent={<Text style={{ color: t.sub, textAlign: 'center', marginTop: 40 }}>No approved templates for this number</Text>}
            renderItem={({ item: x }) => (
              <Pressable disabled={!x.sendable} onPress={() => setPicked(x)} style={{ padding: 14, backgroundColor: t.card, borderBottomColor: t.line, borderBottomWidth: 1, opacity: x.sendable ? 1 : 0.5 }}>
                <Text style={{ color: t.text, fontWeight: '700' }}>{x.name} <Text style={{ color: t.sub, fontWeight: '400' }}>· {x.language}</Text></Text>
                <Text numberOfLines={2} style={{ color: t.sub, marginTop: 3 }}>{x.body}</Text>
                {!x.sendable && <Text style={{ color: t.danger, marginTop: 3, fontSize: 12 }}>Not sendable from the app{x.reason ? ` (${x.reason})` : ''}</Text>}
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}
