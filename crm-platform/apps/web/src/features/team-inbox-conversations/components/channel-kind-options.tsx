'use client';

import { useTranslations } from 'next-intl';
import type { ChannelKind, ChannelResponse } from '@crm/contracts';

/**
 * The chat channels of the inbox channel box, one optgroup per kind (WhatsApp Cloud API, Website chat, ...) under the kind's name, the
 * same heading the Email mailboxes get from EmailChannelOptions. Groups keep the order their first channel has in the list. Email is
 * left out here. The headings use the channel kind names shared with the saved-replies screen, so no new text is needed.
 */
export function ChannelKindOptions({ channels }: { channels: ReadonlyArray<ChannelResponse> }) {
  const tk = useTranslations('team-inbox-conversations.channelKind');
  const groups = new Map<ChannelKind, ChannelResponse[]>();
  for (const c of channels) {
    if (c.kind === 'email') continue;
    const list = groups.get(c.kind) ?? [];
    list.push(c);
    groups.set(c.kind, list);
  }
  return (
    <>
      {[...groups].map(([kind, list]) => (
        <optgroup key={kind} label={tk(kind)} data-testid={`inbox-${kind}-group`}>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
