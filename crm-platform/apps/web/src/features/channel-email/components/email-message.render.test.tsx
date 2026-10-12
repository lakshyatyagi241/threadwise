import { describe, expect, it } from 'vitest';
import { emailMetaSchema } from '@crm/contracts';
import { EmailMessageBody } from './email-message';
import { render } from './render-utils';

const meta = (o: Record<string, unknown> = {}) =>
  emailMetaSchema.parse({
    subject: 'Where is my order?',
    from: { name: 'Asha Rao', address: 'asha@customer.io' },
    to: [{ name: 'Support', address: 'support@acme.com' }],
    cc: [{ name: null, address: 'boss@customer.io' }],
    messageId: 'abc@customer.io',
    threadId: 't1',
    ...o,
  });

const view = (email: ReturnType<typeof meta>, body: string | null = 'plain body') =>
  render(
    <EmailMessageBody
      email={email}
      conversationId="c1"
      messageId="m1"
      body={body}
      date="2026-10-12T09:30:00.000Z"
    />,
  );

describe('email message in the thread', () => {
  it('shows subject, from, to, cc and date', () => {
    const html = view(meta());
    expect(html).toContain('Where is my order?');
    expect(html).toContain('Asha Rao &lt;asha@customer.io&gt;');
    expect(html).toContain('Support &lt;support@acme.com&gt;');
    expect(html).toContain('boss@customer.io');
    expect(html).toContain('<time dateTime="2026-10-12T09:30:00.000Z"');
  });

  it('falls back to the plain text when there is no HTML', () => {
    const html = view(meta({ html: null }), 'Hello there\nSecond line');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('Hello there');
  });

  it('puts the HTML in a frame without scripts, never straight into the page', () => {
    const html = view(
      meta({ html: '<p>Hi</p><script>alert(1)</script><img src="https://t.example/p.gif">' }),
    );
    expect(html).toContain('data-testid="email-frame"');
    expect(html).toMatch(/sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"/);
    expect(html).not.toMatch(/sandbox="[^"]*allow-scripts/);
    expect(html).not.toMatch(/sandbox="[^"]*allow-top-navigation/);
    // The mail's markup only exists inside the escaped srcdoc attribute, never as an element of this page.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<p>Hi</p><');
    expect(html).toContain('srcDoc');
  });

  it('blocks remote pictures and offers Load images only when the mail has some', () => {
    const withRemote = view(meta({ html: '<img src="https://t.example/p.gif">' }));
    expect(withRemote).toContain('data-testid="email-images-blocked"');
    expect(withRemote).toContain('Load images');
    expect(withRemote).toMatch(/img-src data: (?:'|&#x27;)self(?:'|&#x27;);/);
    expect(view(meta({ html: '<p>No pictures</p>' }))).not.toContain('email-load-images');
  });

  it('marks automated mail', () => {
    expect(view(meta({ automated: true }))).toContain('data-testid="email-automated"');
    expect(view(meta())).not.toContain('email-automated');
  });

  it('lists attachments with download links, skips inline ones and says when one was too large', () => {
    const html = view(
      meta({
        attachments: [
          { id: 'a1', name: 'invoice.pdf', mime: 'application/pdf', size: 2048 },
          { id: 'a2', name: 'logo.png', mime: 'image/png', size: 10, inline: true },
          {
            id: 'a3',
            name: 'video.mov',
            mime: 'video/quicktime',
            size: 90 * 1024 * 1024,
            tooLarge: true,
          },
        ],
      }),
    );
    expect(html).toContain('href="/api/v2/email/attachments/c1/m1/a1"');
    expect(html).toContain('invoice.pdf');
    expect(html).not.toContain('logo.png');
    expect(html).toContain('data-testid="email-attachment-large"');
    expect(html).not.toContain('/attachments/c1/m1/a3');
  });

  it('renders in a right-to-left language with its own words', () => {
    const html = render(
      <EmailMessageBody
        email={meta({ html: null })}
        conversationId="c"
        messageId="m"
        body="x"
        date={null}
      />,
      { locale: 'ar' },
    );
    expect(html).toContain('data-testid="email-message"');
  });
});
