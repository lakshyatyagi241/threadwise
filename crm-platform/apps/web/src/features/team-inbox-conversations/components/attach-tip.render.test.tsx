import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { id } from '../lib/fixtures';
import { Composer } from './composer';

const messages = loadMessages('en') as Record<string, unknown>;
const noop = () => undefined;

/** The attach button as the composer draws it: its tooltip (`title`) and its accessible name (`aria-label`). */
function attachButton(channelKind: string, allowed: string[]) {
  const out = renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <Composer
        conversationId={id(1)}
        mode="reply"
        onMode={noop}
        replyDisabled={false}
        canReply
        canNote
        canAttach
        onSend={noop}
        onNote={() => Promise.resolve(true)}
        attachments={{ channelKind, allowed }}
      />
    </NextIntlClientProvider>,
  );
  const tag = out.match(/<button[^>]*aria-label="Attach a file"[^>]*>/)?.[0] ?? '';
  return { tag, title: tag.match(/ title="([^"]*)"/)?.[1] };
}

describe('the attach button tooltip', () => {
  it('lists the formats and the size of each kind for a WhatsApp Cloud channel, from the picker limits', () => {
    const button = attachButton('whatsapp_cloud', ['image', 'video', 'audio', 'document']);
    expect(button.title).toBe(
      'Attach a file. Supported formats and sizes: Images up to 5 MB (JPG, JPEG, PNG) · ' +
        'Video up to 16 MB (MP4, 3GP, 3GPP) · ' +
        'Audio up to 16 MB (AAC, M4A, MP3, AMR, OGG, OPUS) · ' +
        'Documents up to 100 MB (PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT)',
    );
  });

  it('keeps the accessible name and leaves the tooltip to a description', () => {
    const button = attachButton('whatsapp_cloud', ['image', 'video', 'audio', 'document']);
    expect(button.tag).toContain('aria-label="Attach a file"');
    expect(button.tag).toContain('title="Attach a file. Supported formats and sizes:');
  });

  it('names only the kinds the channel takes', () => {
    expect(attachButton('whatsapp_cloud', ['image']).title).toBe(
      'Attach a file. Supported formats and sizes: Images up to 5 MB (JPG, JPEG, PNG)',
    );
  });

  it('is the plain label for a channel without WhatsApp limits (the server checks those files)', () => {
    expect(attachButton('telegram', ['image', 'video', 'audio', 'document']).title).toBe(
      'Attach a file',
    );
  });

  it('is the plain label when a WhatsApp channel takes no kind at all', () => {
    expect(attachButton('whatsapp_cloud', []).title).toBe('Attach a file');
  });
});
