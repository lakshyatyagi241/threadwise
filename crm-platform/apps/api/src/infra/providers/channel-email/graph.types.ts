/** The slice of Microsoft Graph's `message` resource the Email channel reads (v1.0). Every field is optional: Graph omits what is empty. */
export interface GraphEmailAddress {
  emailAddress?: { name?: string | null; address?: string | null };
}

export interface GraphMessage {
  id: string;
  conversationId?: string | null;
  internetMessageId?: string | null;
  subject?: string | null;
  from?: GraphEmailAddress | null;
  sender?: GraphEmailAddress | null;
  toRecipients?: GraphEmailAddress[] | null;
  ccRecipients?: GraphEmailAddress[] | null;
  bccRecipients?: GraphEmailAddress[] | null;
  replyTo?: GraphEmailAddress[] | null;
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  body?: { contentType?: string; content?: string } | null;
  hasAttachments?: boolean;
  isDraft?: boolean;
  isRead?: boolean;
  categories?: string[] | null;
  internetMessageHeaders?: Array<{ name: string; value: string }> | null;
  parentFolderId?: string | null;
  '@removed'?: { reason?: string };
}

export interface GraphAttachment {
  id: string;
  '@odata.type'?: string;
  name?: string | null;
  contentType?: string | null;
  size?: number;
  isInline?: boolean;
  contentId?: string | null;
}

/** One page of a delta round: either `nextLink` (more) or `deltaLink` (the round is complete). */
export interface GraphDeltaPage {
  messages: GraphMessage[];
  nextLink: string | null;
  deltaLink: string | null;
}

/** A draft as Graph answers a create. */
export interface GraphDraft {
  id: string;
  conversationId: string | null;
  internetMessageId: string | null;
}

export interface GraphDraftInput {
  subject: string;
  /** `html` or `text`. */
  bodyType: 'html' | 'text';
  body: string;
  to: string[];
  cc: string[];
  bcc: string[];
  /** Our Message-ID with brackets. */
  internetMessageId: string;
  /** Custom `x-` headers only: Graph refuses any other name. */
  headers: Record<string, string>;
  from?: { name: string | null; address: string };
}
