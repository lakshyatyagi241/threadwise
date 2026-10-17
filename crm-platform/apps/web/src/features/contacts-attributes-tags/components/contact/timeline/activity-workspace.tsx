'use client';

import { useState } from 'react';
import type { ContactRow } from '../../../api/schemas';
import type { FocusRequest } from '../../../lib/sections';
import { ActivityFeed } from './activity-feed';
import { ComposeBox } from './compose-box';

/**
 * What the Overview and the Activity tab share: the compose box (Note, Task, Call, Meeting, inline) and, under it, the timeline, which
 * stretches to the bottom of the column. `bare` leaves the filter pills and the search box out (the Overview). A request from the
 * action row (or a link) opens a compose tab with the cursor in it; so does the empty state's buttons.
 */
export function ActivityWorkspace({
  contact,
  focus,
  bare,
}: {
  contact: ContactRow;
  /** A request from the action row (or a link) to open a compose tab with the cursor in it. */
  focus?: FocusRequest | null;
  bare?: boolean;
}) {
  // What the page itself asks for (the empty state's buttons) is a request like the action row's.
  const [own, setOwn] = useState<FocusRequest | null>(null);
  const [seen, setSeen] = useState<FocusRequest | null>(null);
  let request = own;
  if (focus && focus !== seen) {
    setSeen(focus);
    setOwn(focus);
    request = focus;
  }
  const ask = (target: FocusRequest['target']) => setOwn((r) => ({ target, n: (r?.n ?? 0) + 1 }));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ComposeBox contact={contact} focus={request} />
      <ActivityFeed contact={contact} bare={bare} onCompose={(tab) => ask(tab)} />
    </div>
  );
}
