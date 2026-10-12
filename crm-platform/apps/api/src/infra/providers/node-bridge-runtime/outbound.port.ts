/**
 * What can be sent through a WhatsApp number (TW-NODE-022 to 025). One command shape for every engine; a transport that cannot
 * send a kind says so with UnsupportedSendError, and its text is shown to the user, so it says what to do instead.
 */
/** The message a send answers (a reply in a thread). In a group, `participant` is who wrote it (their id) so WhatsApp can show the quote. */
export interface SendQuote {
  /** WhatsApp's id of the quoted message. */
  providerMessageId: string;
  fromMe: boolean;
  participant?: string;
  /** What to show in the quote when the app has the text. */
  text?: string;
}

export type SendCommand = SendCommandBody & { quote?: SendQuote };

type SendCommandBody =
  | { type: 'text'; to: string; body: string; footer?: string; toGroup?: boolean }
  | {
      type: 'media';
      to: string;
      /** `to` is a group id (bare or `...@g.us`), not a phone number. Every kind except `group_text` addresses a group this way. */
      toGroup?: boolean;
      /** Where to fetch it from; empty when the bytes are given (`data` in this process, `bufferKey` between processes). */
      mediaUrl: string;
      /** The file itself, when the caller already holds it (the inbox's stored media). */
      data?: Buffer;
      /** Where the bytes wait in Redis while the command travels to the worker that owns the device. */
      bufferKey?: string;
      caption?: string;
      fileName?: string;
      mimeType?: string;
      voiceNote?: boolean;
    }
  | {
      type: 'location';
      to: string;
      toGroup?: boolean;
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    }
  | {
      type: 'contact';
      to: string;
      toGroup?: boolean;
      name: string;
      phone: string;
      vcard?: string;
      /** Several cards in one message (the inbox's Share dialog); when set, `vcard` and `phone` are not used. */
      cards?: { name: string; vcard: string }[];
    }
  /**
   * Text into a group. `groupJid` is the bare id or `...@g.us`. `mentions` are WhatsApp ids of members (a participant's `jid`); the body must
   * contain `@<user part of the id>` for WhatsApp to draw the tag (see `mentionToken` in group-mapping.ts).
   */
  | { type: 'group_text'; groupJid: string; body: string; mentions?: string[] };

export interface SendContext {
  /** Correlates the provider's later receipts back to our row. */
  clientReference: string;
  /** What the pre-send guard needs to know (bulk sends are screened harder than a single reply). */
  screen?: { bulk?: boolean; source?: string };
}

export interface SendOutcome {
  /** The provider's message id; null when the transport cannot tell. */
  providerMessageId: string | null;
}

/** The transport cannot send this kind of message. */
export class UnsupportedSendError extends Error {}

/** A change to a message already sent or received (TW-NODE-025). `messageId` is WhatsApp's id for it. */
export type MessageAction =
  | {
      type: 'react';
      to: string;
      messageId: string;
      fromMe: boolean;
      emoji: string;
      /** In a group, the id of whoever wrote the message being reacted to (WhatsApp needs it to place the reaction). */
      participant?: string;
    }
  | { type: 'pin'; to: string; messageId: string; fromMe: boolean; pin: boolean }
  | { type: 'star'; to: string; messageId: string; fromMe: boolean; star: boolean }
  | { type: 'edit'; to: string; messageId: string; text: string }
  | { type: 'delete'; to: string; messageId: string; fromMe: boolean };
