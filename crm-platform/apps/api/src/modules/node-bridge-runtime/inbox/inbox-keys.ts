/** Redis keys shared by the unofficial engine's inbox adapter (WD-NODE-017) and its inbound bridge. */
export const inboxKeys = {
  /** A customer's file, held until the inbox's ingest job stores it. The id after the prefix is what travels as `providerMediaId`. */
  inboundMedia: (id: string) => `wa:in:media:${id}`,
  /** Marks a message the inbox sent through a device; the value is the channel uuid its delivery reports belong to. */
  sent: (providerMessageId: string) => `wa:inbox:sent:${providerMessageId}`,
};

/** A file waits this long for the ingest job. The queue retries for about a minute; past this it is stored without the file. */
export const INBOUND_MEDIA_TTL_S = 15 * 60;
/** Delivery reports arrive for days after a send (read receipts), so the marker outlives the usual retry window. */
export const SENT_MARKER_TTL_S = 7 * 24 * 3600;
