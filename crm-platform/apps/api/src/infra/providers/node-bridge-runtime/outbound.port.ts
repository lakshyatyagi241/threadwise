/**
 * What can be sent through a WhatsApp number (WD-NODE-022 to 025). One command shape for every engine; a transport that cannot
 * send a kind says so with UnsupportedSendError, and its text is shown to the user, so it says what to do instead.
 */
export type SendCommand =
  | { type: 'text'; to: string; body: string; footer?: string }
  | {
      type: 'media';
      to: string;
      mediaUrl: string;
      caption?: string;
      fileName?: string;
      mimeType?: string;
      voiceNote?: boolean;
    }
  | {
      type: 'location';
      to: string;
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    }
  | { type: 'contact'; to: string; name: string; phone: string; vcard?: string }
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

/** A change to a message already sent or received (WD-NODE-025). `messageId` is WhatsApp's id for it. */
export type MessageAction =
  | { type: 'react'; to: string; messageId: string; fromMe: boolean; emoji: string }
  | { type: 'pin'; to: string; messageId: string; fromMe: boolean; pin: boolean }
  | { type: 'star'; to: string; messageId: string; fromMe: boolean; star: boolean }
  | { type: 'edit'; to: string; messageId: string; text: string }
  | { type: 'delete'; to: string; messageId: string; fromMe: boolean };
