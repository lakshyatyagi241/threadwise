import { ERROR_CODES, MESSAGE_CAPTION_MAX } from '@crm/contracts';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { TextField } from '@/components/ui/text-field';
import { Text } from '@/components/ui/text';
import { CLIENT_ERROR_CODES, isApiError } from '@/lib/api';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import type { PickedAttachment } from './attachment';
import { formatBytes } from './message-parts';
import { attachErrorMessage } from './thread-errors';
import { useSendMedia, useUploadMedia } from './use-inbox';

const FILE_ICON: Record<PickedAttachment['kind'], IconName> = {
  image: 'image-outline',
  video: 'videocam-outline',
  audio: 'musical-notes-outline',
  document: 'document-outline',
};

const PICTURE_HEIGHT = 240;

interface Props {
  /** The file to send; the sheet is open while there is one. */
  file: PickedAttachment | null;
  conversationId: string;
  onClose: () => void;
}

/** What the person sees after choosing a file: the file, a caption box, and Send. Closing it throws the file away. */
export function AttachPreviewSheet({ file, conversationId, onClose }: Props) {
  // Set by the body while the message itself is being sent: the back button must not close the sheet then, or the person would never learn
  // how it ended. While the file is still going up, closing cancels the upload.
  const sending = useRef(false);
  return (
    <Modal
      transparent
      visible={file !== null}
      animationType="slide"
      onRequestClose={() => {
        if (!sending.current) onClose();
      }}
    >
      {/* Only mounted while there is a file, so a new file starts with a fresh caption and upload. */}
      {file ? (
        <SheetBody
          file={file}
          conversationId={conversationId}
          sendingRef={sending}
          onClose={onClose}
        />
      ) : null}
    </Modal>
  );
}

function SheetBody({
  file,
  conversationId,
  sendingRef,
  onClose,
}: {
  file: PickedAttachment;
  conversationId: string;
  sendingRef: MutableRefObject<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const upload = useUploadMedia();
  const send = useSendMedia(conversationId);
  const [caption, setCaption] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  // One id for the message and one for the upload, kept across attempts: pressing Send again after a dropped connection repeats the
  // same request instead of making a second message, and a file that is already up is not uploaded again.
  const clientMessageId = useRef(Crypto.randomUUID());
  const uploadKey = useRef(Crypto.randomUUID());
  const uploadedId = useRef<string | null>(null);
  const busy = upload.isPending || send.isPending;
  // Once the message has been sent (or tried), the caption is fixed: a retry repeats the same request, so it must carry the same words.
  const [locked, setLocked] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const tooLong = caption.trim().length > MESSAGE_CAPTION_MAX;
  useEffect(() => {
    sendingRef.current = send.isPending;
    return () => {
      sendingRef.current = false;
    };
  }, [send.isPending, sendingRef]);

  /** Closing while the file is going up cancels the upload; while the message is being sent the sheet stays (see the outer component). */
  const close = () => {
    if (send.isPending) return;
    abort.current?.abort();
    onClose();
  };

  const submit = async () => {
    setFailed(null);
    try {
      if (!uploadedId.current) {
        abort.current = new AbortController();
        const stored = await upload.mutateAsync({
          file,
          idempotencyKey: uploadKey.current,
          signal: abort.current.signal,
        });
        uploadedId.current = stored.id;
      }
      setLocked(true);
      await send.mutateAsync({
        clientMessageId: clientMessageId.current,
        mediaId: uploadedId.current,
        caption,
      });
      onClose();
    } catch (error) {
      // The person cancelled the upload: the sheet is already closing, there is nothing to say.
      if (isApiError(error) && error.code === CLIENT_ERROR_CODES.ABORTED) return;
      if (isApiError(error) && error.code === ERROR_CODES.MESSAGE_MEDIA_NOT_FOUND) {
        // The upload is gone (it waits 24 hours), so the message was not made: the next Send uploads the file again and is a new message.
        uploadedId.current = null;
        uploadKey.current = Crypto.randomUUID();
        clientMessageId.current = Crypto.randomUUID();
        setLocked(false);
      }
      setFailed(attachErrorMessage(error, t));
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('inbox.attach.close')}
        disabled={send.isPending}
        onPress={close}
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
      />
      <View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
      >
        <View style={styles.header}>
          <Text variant="heading" accessibilityRole="header" style={styles.title}>
            {t('inbox.attach.previewTitle')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('inbox.attach.close')}
            accessibilityState={{ disabled: send.isPending }}
            disabled={send.isPending}
            onPress={close}
            style={styles.close}
          >
            <Icon name="close" size={24} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {failed ? <Banner tone="danger" message={failed} /> : null}
          {file.kind === 'image' ? (
            <Image
              testID="attach-preview-image"
              accessibilityLabel={file.name}
              source={{ uri: file.uri }}
              resizeMode="contain"
              style={[styles.picture, { backgroundColor: colors.surfaceMuted }]}
            />
          ) : (
            <View style={[styles.tile, { backgroundColor: colors.surfaceMuted }]}>
              <Icon name={FILE_ICON[file.kind]} size={32} color="textMuted" />
              <View style={styles.tileText}>
                <Text variant="label" numberOfLines={2}>
                  {file.name}
                </Text>
                {file.sizeBytes !== null ? (
                  <Text variant="caption" muted>
                    {formatBytes(file.sizeBytes)}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
          <TextField
            label={t('inbox.attach.caption')}
            value={caption}
            onChangeText={setCaption}
            multiline
            editable={!busy && !locked}
            error={tooLong ? t('inbox.attach.captionTooLong', { max: MESSAGE_CAPTION_MAX }) : null}
          />
          <Button
            label={t('inbox.attach.send')}
            loading={busy}
            disabled={tooLong}
            onPress={() => void submit()}
          />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg },
  title: { flex: 1 },
  close: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: spacing.lg, gap: spacing.lg },
  picture: { width: '100%', height: PICTURE_HEIGHT, borderRadius: radius.md },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
  },
  tileText: { flex: 1, gap: spacing.xs },
});
