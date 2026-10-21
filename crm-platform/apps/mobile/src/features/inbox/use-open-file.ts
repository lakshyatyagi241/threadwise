import type { MessageMedia } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { env } from '@/config/env';
import { getAccessToken } from '@/lib/auth/session-manager';
import { downloadReceivedFile, openReceivedFile } from '@/lib/device/received-files';
import { log } from '@/lib/observability/logger';
import { messagesRoot } from './use-inbox';
import { isApiAddress, mediaUri } from './use-media-source';

export type OpenFileState = 'idle' | 'working' | 'failed' | 'noApp';

/**
 * Opens a file of a conversation (a document, a video, a recording): downloads it with the signed-in person's token, then hands it to
 * the phone. A failed download usually means the link (valid for minutes) has run out, so the messages are read again and the next
 * tap has a fresh one.
 */
export function useOpenFile(media: MessageMedia) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [state, setState] = useState<OpenFileState>('idle');
  const alive = useRef(true);
  // Read straight away, not from the last render: two quick presses must start one download, not two.
  const working = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const open = useCallback(async () => {
    if (working.current) return;
    working.current = true;
    setState('working');
    let next: OpenFileState = 'idle';
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('signed out');
      const uri = mediaUri(media.url, env.apiUrl);
      // The token is the person's own: it goes only to the API, never to another address a link might name.
      if (!isApiAddress(uri, env.apiUrl)) throw new Error('not an address on the API');
      const file = await downloadReceivedFile({ uri, token, name: media.name });
      const result = await openReceivedFile(
        file,
        media.mime,
        t('inbox.file.shareTitle'),
        media.name,
      );
      next = result === 'noApp' ? 'noApp' : 'idle';
    } catch (error) {
      log.warn('inbox.file_open_failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      void queryClient.invalidateQueries({ queryKey: messagesRoot });
      next = 'failed';
    }
    working.current = false;
    if (alive.current) setState(next);
  }, [media.mime, media.name, media.url, queryClient, t]);

  return { state, open };
}
