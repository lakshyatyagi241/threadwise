import { describe, expect, it } from 'vitest';
import {
  classifyGraphError,
  classifyMicrosoftTokenError,
  graphSkip,
  normaliseGraphMessage,
  parseRetryAfter,
  type GraphMessage,
} from '../../../src/infra/providers/channel-email';
import { canonicalScopes } from '../../../src/modules/channel-email/drivers/microsoft-mail.driver';

describe('Microsoft token errors (TW-MAIL-034)', () => {
  it.each([
    [400, { error: 'invalid_grant', error_codes: [700082] }, 'invalid_grant'],
    [400, { error: 'invalid_grant', error_codes: [50173] }, 'invalid_grant'],
    [400, { error: 'interaction_required', error_codes: [50076] }, 'invalid_grant'],
    [
      400,
      { error: 'x', error_description: 'AADSTS65001: consent', error_codes: [65001] },
      'invalid_grant',
    ],
    [401, { error: 'invalid_client', error_codes: [7000215] }, 'invalid_client'],
    [400, { error: 'invalid_request', error_codes: [7000222] }, 'invalid_client'],
    [400, { error: 'invalid_request', error_codes: [50194] }, 'invalid_client'],
    [429, {}, 'rate_limit'],
    [503, {}, 'server'],
    [400, { error: 'invalid_request' }, 'bad_request'],
  ])('%s %j is %s', (status, body, kind) => {
    expect(classifyMicrosoftTokenError(status, body).kind).toBe(kind);
  });
});

describe('Graph API errors (TW-MAIL-034)', () => {
  it.each([
    [401, 'InvalidAuthenticationToken', 'auth'],
    [403, 'ErrorAccessDenied', 'forbidden'],
    [404, 'MailboxNotEnabledForRESTAPI', 'forbidden'],
    [404, 'ErrorItemNotFound', 'not_found'],
    [410, 'syncStateNotFound', 'gone'],
    [429, 'TooManyRequests', 'rate_limit'],
    [503, 'ErrorServerBusy', 'rate_limit'],
    [503, '', 'server'],
    [413, '', 'too_large'],
    [400, 'ErrorInvalidRecipients', 'bad_request'],
  ])('%s %s is %s', (status, code, kind) => {
    const body = code ? { error: { code } } : {};
    expect(classifyGraphError(status, body).kind).toBe(kind);
  });

  it('carries Retry-After and only retryable kinds are retryable', () => {
    const e = classifyGraphError(429, {}, 12);
    expect(e.retryAfterSeconds).toBe(12);
    expect(e.retryable).toBe(true);
    expect(classifyGraphError(400, {}).retryable).toBe(false);
  });

  it('parses Retry-After as seconds or a date, and clamps it', () => {
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter('999999')).toBe(3600);
    expect(
      parseRetryAfter('Wed, 21 Oct 2026 07:28:30 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')),
    ).toBe(30);
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});

describe('scopes', () => {
  it('are canonical whatever the case or prefix', () => {
    expect(
      canonicalScopes('https://graph.microsoft.com/mail.read Mail.SEND user.read OpenID'),
    ).toEqual(['Mail.Read', 'Mail.Send', 'User.Read', 'openid']);
  });
});

const msg = (over: Partial<GraphMessage> = {}): GraphMessage => ({
  id: 'M1',
  conversationId: 'conv-1',
  internetMessageId: '<a@x.example>',
  subject: 'Hi',
  from: { emailAddress: { name: 'Ana', address: 'Ana@Example.com' } },
  toRecipients: [{ emailAddress: { address: 'support@acme.test' } }],
  receivedDateTime: '2026-10-01T10:00:00Z',
  body: { contentType: 'html', content: '<p>Hello</p>' },
  internetMessageHeaders: [
    { name: 'References', value: '<r1@x.example> <r2@x.example>' },
    { name: 'In-Reply-To', value: '<r2@x.example>' },
    { name: 'Content-Type', value: 'text/html; charset=utf-8' },
  ],
  ...over,
});

describe('normaliseGraphMessage', () => {
  it('maps addresses, headers, thread key and body', () => {
    const mail = normaliseGraphMessage(msg(), [], async () => Buffer.alloc(0));
    expect(mail).toMatchObject({
      providerMessageId: 'M1',
      messageId: 'a@x.example',
      inReplyTo: 'r2@x.example',
      references: ['r1@x.example', 'r2@x.example'],
      from: { name: 'Ana', address: 'ana@example.com' },
      html: '<p>Hello</p>',
      text: '',
      automated: false,
      skip: null,
    });
    expect(mail.threadKey).toBe('c:conv-1');
    expect(mail.to).toEqual([{ name: null, address: 'support@acme.test' }]);
  });

  it('uses the From header when Graph gives an Exchange-internal address, and a stable synthetic Message-ID without one', () => {
    const mail = normaliseGraphMessage(
      msg({
        internetMessageId: null,
        from: { emailAddress: { address: '/O=EXCH/OU=X/CN=RECIPIENTS/CN=bob' } },
        sender: null,
        internetMessageHeaders: [{ name: 'From', value: 'Bob <bob@contoso.test>' }],
      }),
      [],
      async () => Buffer.alloc(0),
    );
    expect(mail.from.address).toBe('bob@contoso.test');
    expect(mail.messageId).toMatch(/^graph-[0-9a-f]{24}@graph\.invalid$/);
  });

  it('flags automated mail and keeps a text body as text', () => {
    const mail = normaliseGraphMessage(
      msg({
        body: { contentType: 'text', content: 'plain' },
        internetMessageHeaders: [{ name: 'Auto-Submitted', value: 'auto-replied' }],
      }),
      [],
      async () => Buffer.alloc(0),
    );
    expect(mail.automated).toBe(true);
    expect(mail.text).toBe('plain');
    expect(mail.html).toBeNull();
  });

  it('lists files, attached messages (as .eml) and links without bytes', async () => {
    const mail = normaliseGraphMessage(
      msg(),
      [
        {
          id: 'a1',
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: 'x.pdf',
          contentType: 'application/pdf',
          size: 3,
          isInline: false,
        },
        { id: 'a2', '@odata.type': '#microsoft.graph.itemAttachment', name: 'Original', size: 9 },
        { id: 'a3', '@odata.type': '#microsoft.graph.referenceAttachment', name: 'cloud', size: 0 },
        {
          id: 'a4',
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: 'l.png',
          contentType: 'image/png',
          size: 1,
          isInline: true,
          contentId: '<logo1>',
        },
      ],
      async (m, a) => Buffer.from(`${m}/${a}`),
    );
    expect(
      mail.attachments.map((a) => [a.name, a.mime, a.inline, a.contentId, a.fetch !== null]),
    ).toEqual([
      ['x.pdf', 'application/pdf', false, null, true],
      ['Original.eml', 'message/rfc822', false, null, true],
      ['cloud', 'application/octet-stream', false, null, false],
      ['l.png', 'image/png', true, 'logo1', true],
    ]);
    expect((await mail.attachments[0]!.fetch!()).toString()).toBe('M1/a1');
  });
});

describe('graphSkip', () => {
  it('skips drafts and the mailbox own mail, nothing else', () => {
    expect(graphSkip(msg({ isDraft: true }), 'support@acme.test')).toBe('draft');
    expect(
      graphSkip(
        msg({ from: { emailAddress: { address: 'Support@Acme.test' } } }),
        'support@acme.test',
      ),
    ).toBe('sent');
    expect(graphSkip(msg(), 'support@acme.test')).toBeNull();
  });
});
