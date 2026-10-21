import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { openPermissionSettings } from '@/lib/device/open-settings';
import { attachmentProblem, type PickedAttachment } from './attachment';
import type { AttachSource } from './attach-menu';
import {
  discardAttachment,
  pickDocument,
  pickFromCamera,
  pickFromLibrary,
  type PickResult,
} from './pick-attachment';

/** Why nothing was attached, in a form the screen turns into words (`tooLarge` carries the kind's limit). */
export type AttachNotice =
  | { kind: 'tooLarge'; attachment: PickedAttachment }
  | { kind: 'empty' }
  | { kind: 'cameraOff' }
  | { kind: 'pickFailed' };

const PICKERS: Record<AttachSource, () => Promise<PickResult>> = {
  library: pickFromLibrary,
  camera: pickFromCamera,
  document: pickDocument,
};

/**
 * The attach flow of one conversation: the sheet under the paperclip, then the phone's own picker (library, camera or file browser),
 * then the preview with a caption. The sheet is closed before the picker is shown, because a picker cannot open on top of a
 * modal (iOS refuses; Android is unreliable), so the choice is held until the sheet has gone.
 */
export function useAttachFlow() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [file, setFile] = useState<PickedAttachment | null>(null);
  const [notice, setNotice] = useState<AttachNotice | null>(null);
  const waiting = useRef<AttachSource | null>(null);
  // A picker is already open or about to be: a second tap on an option must not start another.
  const picking = useRef(false);

  const run = useCallback(async (source: AttachSource) => {
    if (picking.current) return;
    picking.current = true;
    try {
      const result = await PICKERS[source]();
      if (result.status === 'canceled') return;
      if (result.status === 'cameraDenied') return setNotice({ kind: 'cameraOff' });
      if (result.status === 'failed') return setNotice({ kind: 'pickFailed' });
      const problem = attachmentProblem(result.attachment);
      if (problem === 'empty') {
        discardAttachment(result.attachment);
        return setNotice({ kind: 'empty' });
      }
      if (problem === 'tooLarge') {
        discardAttachment(result.attachment);
        return setNotice({ kind: 'tooLarge', attachment: result.attachment });
      }
      setFile(result.attachment);
    } finally {
      picking.current = false;
    }
  }, []);

  const open = useCallback(() => {
    waiting.current = null;
    setNotice(null);
    setMenuOpen(true);
  }, []);

  const choose = useCallback(
    (source: AttachSource) => {
      setMenuOpen(false);
      setNotice(null);
      // iOS: wait for the sheet's onDismiss. Android has no such event, so the picker starts at once.
      if (Platform.OS === 'ios') waiting.current = source;
      else void run(source);
    },
    [run],
  );

  const onMenuDismissed = useCallback(() => {
    const source = waiting.current;
    waiting.current = null;
    if (source) void run(source);
  }, [run]);

  return {
    menuOpen,
    closeMenu: () => setMenuOpen(false),
    file,
    // Every way out of the preview (sent, cancelled) removes the app's copy of the file.
    closeFile: () => {
      if (file) discardAttachment(file);
      setFile(null);
    },
    notice,
    clearNotice: () => setNotice(null),
    open,
    choose,
    onMenuDismissed,
    openSettings: () => void openPermissionSettings(),
  };
}
