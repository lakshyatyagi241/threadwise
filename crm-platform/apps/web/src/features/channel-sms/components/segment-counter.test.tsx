import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { SegmentCounter } from './segment-counter';

const messages = loadMessages('en');
const html = (text: string) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SegmentCounter text={text} />
    </NextIntlClientProvider>,
  ).replace(/<!-- -->/g, '');

describe('SegmentCounter', () => {
  it('shows the count and no warning for a one-segment text', () => {
    const out = html('Hello');
    expect(out).toContain('5 characters · 1 segment · GSM-7');
    expect(out).toContain('155 left in this segment');
    expect(out).not.toContain('role="note"');
  });

  it('warns that an emoji text is billed per 67 characters once it needs two segments', () => {
    const out = html('😀'.repeat(40));
    expect(out).toContain('UCS-2');
    expect(out).toContain('limited to 67 characters per SMS and will be billed as 2 messages');
  });

  it('warns about plain text longer than 160 characters', () => {
    const out = html('a'.repeat(200));
    expect(out).toContain('200 characters · 2 segments · GSM-7');
    expect(out).toContain('This message is 200 characters and will be billed as 2 messages.');
  });
});
