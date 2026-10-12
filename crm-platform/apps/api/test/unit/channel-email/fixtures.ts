import type {
  GmailHeader,
  GmailMessage,
  GmailPart,
} from '../../../src/infra/providers/channel-email';

export const b64 = (s: string | Buffer): string => Buffer.from(s).toString('base64url');
export const h = (name: string, value: string): GmailHeader => ({ name, value });

export const textPart = (text: string, charset = 'UTF-8', partId = '0.0'): GmailPart => ({
  partId,
  mimeType: 'text/plain',
  filename: '',
  headers: [h('Content-Type', `text/plain; charset="${charset}"`)],
  body: { size: text.length, data: b64(text) },
});

export const htmlPart = (html: string, partId = '0.1'): GmailPart => ({
  partId,
  mimeType: 'text/html',
  filename: '',
  headers: [h('Content-Type', 'text/html; charset="UTF-8"')],
  body: { size: html.length, data: b64(html) },
});

export const filePart = (
  partId: string,
  filename: string,
  mimeType: string,
  opts: {
    attachmentId?: string;
    data?: Buffer;
    size?: number;
    contentId?: string;
    disposition?: string;
  } = {},
): GmailPart => ({
  partId,
  mimeType,
  filename,
  headers: [
    h('Content-Type', `${mimeType}; name="${filename}"`),
    h('Content-Disposition', `${opts.disposition ?? 'attachment'}; filename="${filename}"`),
    ...(opts.contentId ? [h('Content-ID', `<${opts.contentId}>`)] : []),
  ],
  body: {
    size: opts.size ?? opts.data?.length ?? 0,
    ...(opts.attachmentId ? { attachmentId: opts.attachmentId } : {}),
    ...(opts.data ? { data: b64(opts.data) } : {}),
  },
});

export interface MessageOptions {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  headers?: GmailHeader[];
  parts?: GmailPart[];
  mimeType?: string;
  internalDate?: string;
}

/** A Gmail `format=full` message with the usual headers; every header can be overridden through `headers` (a later one with the same name loses to the first). */
export function gmailMessage(o: MessageOptions = {}): GmailMessage {
  return {
    id: o.id ?? 'm1',
    threadId: o.threadId ?? 't1',
    labelIds: o.labelIds ?? ['INBOX', 'UNREAD'],
    internalDate: o.internalDate ?? '1760000000000',
    sizeEstimate: 1000,
    payload: {
      partId: '',
      mimeType: o.mimeType ?? 'multipart/alternative',
      filename: '',
      headers: [
        ...(o.headers ?? []),
        h('From', 'Ana Customer <ana@example.com>'),
        h('To', 'support@acme.test'),
        h('Subject', 'Order question'),
        h('Message-ID', '<abc123@mail.example.com>'),
        h('Date', 'Mon, 08 Oct 2026 10:00:00 +0000'),
      ],
      body: { size: 0 },
      parts: o.parts ?? [textPart('Hello there'), htmlPart('<p>Hello <b>there</b></p>')],
    },
  };
}
