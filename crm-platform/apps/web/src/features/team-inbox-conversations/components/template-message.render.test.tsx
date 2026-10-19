import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MessageTemplate, MessageTemplateHeader } from '@crm/contracts';
import { TemplateMessage } from './template-message';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'team-inbox-conversations.json'), 'utf8'),
) as Record<string, unknown>;

const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      {el}
    </NextIntlClientProvider>,
  );

const template = (header: MessageTemplateHeader): MessageTemplate =>
  ({
    templateId: '8a1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e11',
    name: 'mahalaya_20261010',
    language: 'en',
    variables: {},
    preview: { header, footer: null, buttons: [] },
  }) as MessageTemplate;

describe('template message media header', () => {
  it('plays the header video when the template still has a file to show', () => {
    const out = html(
      <TemplateMessage
        template={template({
          format: 'video',
          text: null,
          mediaUrl: 'https://files.example/h.mp4',
        })}
        text="Body"
      />,
    );
    expect(out).toContain('<video');
    expect(out).toContain('src="https://files.example/h.mp4"');
    expect(out).not.toContain('data-testid="inbox-template-media"');
  });

  it('shows the header image when the template still has a file to show', () => {
    const out = html(
      <TemplateMessage
        template={template({
          format: 'image',
          text: null,
          mediaUrl: 'https://files.example/h.jpg',
        })}
        text="Body"
      />,
    );
    expect(out).toContain('<img');
    expect(out).toContain('src="https://files.example/h.jpg"');
  });

  it('keeps the marker when no file link is left', () => {
    const out = html(
      <TemplateMessage template={template({ format: 'video', text: null })} text="Body" />,
    );
    expect(out).toContain('data-testid="inbox-template-media"');
    expect(out).toContain('data-format="video"');
    expect(out).not.toContain('<video');
  });

  it('keeps the marker for a location header even if a link were passed', () => {
    const out = html(
      <TemplateMessage
        template={template({ format: 'location', text: null, mediaUrl: 'https://files.example/x' })}
        text="Body"
      />,
    );
    expect(out).toContain('data-format="location"');
    expect(out).not.toContain('files.example');
  });
});
