import { z } from 'zod';

/**
 * The announcement strip (WD-ASHELL-026): active announcements grouped by tone, one bar per tone. A bar scrolls its items as a
 * marquee and can be dismissed in the browser; the dismissal key changes when the group's members change, so a new
 * announcement brings the bar back.
 */
export const announcementItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  linkUrl: z.string().nullable(),
  linkLabel: z.string().nullable(),
});
export type AnnouncementItem = z.infer<typeof announcementItemSchema>;

export const announcementBarSchema = z.object({
  tone: z.string(),
  /** The ids of the group joined: the key of the browser-side dismissal. */
  token: z.string(),
  /** A dismiss button shows when any item in the group allows it. */
  dismissible: z.boolean(),
  items: z.array(announcementItemSchema),
});
export type AnnouncementBar = z.infer<typeof announcementBarSchema>;

export const announcementsResponseSchema = z.object({ bars: z.array(announcementBarSchema) });
export type AnnouncementsResponse = z.infer<typeof announcementsResponseSchema>;

export interface AnnouncementRow {
  uuid: string;
  text: string;
  link_url: string | null;
  link_label: string | null;
  tone: string;
  dismissible: boolean;
}

/** Rows arrive already filtered to the active scope and ordered by `sort_order`, `id`; this groups them by tone. */
export function groupAnnouncements(rows: readonly AnnouncementRow[]): AnnouncementBar[] {
  const order: string[] = [];
  const groups = new Map<string, AnnouncementRow[]>();
  for (const r of rows) {
    const tone = r.tone || 'info';
    if (!groups.has(tone)) {
      groups.set(tone, []);
      order.push(tone);
    }
    groups.get(tone)!.push(r);
  }
  return order.map((tone) => {
    const list = groups.get(tone)!;
    return {
      tone,
      token: list.map((r) => r.uuid).join('-'),
      dismissible: list.some((r) => r.dismissible),
      items: list.map((r) => ({
        id: r.uuid,
        text: r.text,
        linkUrl: r.link_url,
        linkLabel: r.link_label,
      })),
    };
  });
}

/** Seconds for one marquee pass: `max(20, totalChars / 5)`, as WaDesk. */
export const marqueeSeconds = (
  items: readonly { text: string; linkLabel: string | null }[],
): number =>
  Math.max(20, items.reduce((n, i) => n + i.text.length + (i.linkLabel?.length ?? 0), 0) / 5);
