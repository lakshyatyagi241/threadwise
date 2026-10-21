import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { log } from '@/lib/observability/logger';
import { attachmentFrom, type PickedAttachment } from './attachment';

/** Only the kind of failure goes to the log: an error's message can carry the file's address, and a file's name can be personal. */
const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'unknown');

/** What choosing a file came to: a file, nothing (the person went back), or the camera is off. */
export type PickResult =
  | { status: 'picked'; attachment: PickedAttachment }
  | { status: 'canceled' }
  | { status: 'cameraDenied'; canAskAgain: boolean }
  | { status: 'failed' };

const fromImageAsset = (asset: ImagePicker.ImagePickerAsset): PickResult => ({
  status: 'picked',
  attachment: attachmentFrom({
    uri: asset.uri,
    name: asset.fileName,
    mime: asset.mimeType,
    sizeBytes: asset.fileSize,
  }),
});

/**
 * A picture or video from the phone's library. The system picker shows only what the person chooses, so no permission is
 * asked for. One file at a time: a caption belongs to one message.
 */
export async function pickFromLibrary(): Promise<PickResult> {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: false,
      quality: 0.8,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    return asset ? fromImageAsset(asset) : { status: 'canceled' };
  } catch (error) {
    log.warn('inbox.attach_library_failed', { error: errorName(error) });
    return { status: 'failed' };
  }
}

/** A photo taken now. The camera permission is asked for here, at the moment of use; a refusal is reported so the sheet can say where to turn it on. */
export async function pickFromCamera(): Promise<PickResult> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { status: 'cameraDenied', canAskAgain: permission.canAskAgain };
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    const asset = result.canceled ? undefined : result.assets[0];
    return asset ? fromImageAsset(asset) : { status: 'canceled' };
  } catch (error) {
    log.warn('inbox.attach_camera_failed', { error: errorName(error) });
    return { status: 'failed' };
  }
}

/** A file from the phone's storage or cloud drives (the system file browser, no permission). It is copied to the app's cache so it can be read for the upload. */
export async function pickDocument(): Promise<PickResult> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      multiple: false,
      copyToCacheDirectory: true,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return { status: 'canceled' };
    return {
      status: 'picked',
      attachment: attachmentFrom({
        uri: asset.uri,
        name: asset.name,
        mime: asset.mimeType,
        sizeBytes: asset.size,
      }),
    };
  } catch (error) {
    log.warn('inbox.attach_document_failed', { error: errorName(error) });
    return { status: 'failed' };
  }
}

/**
 * Deletes the app's own copy of a chosen file (the picker, the camera and the document browser all leave one in the cache). A
 * customer's ID or contract must not sit on the phone after it has been sent or dropped. A file outside the cache is the person's
 * own and is never touched.
 */
export function discardAttachment(file: PickedAttachment): void {
  try {
    if (!file.uri.startsWith(Paths.cache.uri)) return;
    new File(file.uri).delete();
  } catch (error) {
    log.warn('inbox.attach_discard_failed', { error: errorName(error) });
  }
}
