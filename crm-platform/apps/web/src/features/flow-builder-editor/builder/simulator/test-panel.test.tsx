import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LogBubble, TestPanel } from './test-panel';

vi.mock('../../api/flows', () => ({ flowsApi: { testWebhook: vi.fn() } }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

describe('test panel', () => {
  it('renders nothing when closed', () => {
    expect(
      renderToStaticMarkup(
        <TestPanel open={false} onClose={() => undefined} nodes={[]} edges={[]} runNonce={0} />,
      ),
    ).toBe('');
  });

  it('open: title, restart/close, and a disabled input until the bot awaits', () => {
    const html = renderToStaticMarkup(
      <TestPanel open onClose={() => undefined} nodes={[]} edges={[]} runNonce={0} />,
    );
    // The mock above echoes the message keys.
    expect(html).toContain('aria-label="dialogLabel"');
    expect(html).toContain('>title<');
    expect(html).toContain('>subtitle<');
    expect(html).toContain('>restart<');
    expect(html).toContain('w-[380px]');
    expect(html).toContain('placeholder="waitingForBot"');
    expect(html).toContain('disabled=""');
  });

  it('bubbles: system italic, user right, bot media by kind', () => {
    const r = (e: Parameters<typeof LogBubble>[0]['entry']) =>
      renderToStaticMarkup(<LogBubble entry={e} />);
    expect(r({ kind: 'system', text: 'note' })).toContain('italic');
    expect(r({ kind: 'user', text: 'hi' })).toContain('self-end');
    expect(
      r({ kind: 'bot', text: 'c', media: { kind: 'image', url: '/a.png', filename: 'a' } }),
    ).toContain('<img');
    expect(
      r({ kind: 'bot', text: '', media: { kind: 'video', url: '/a.mp4', filename: '' } }),
    ).toContain('<video');
    expect(
      r({ kind: 'bot', text: '', media: { kind: 'audio', url: '/a.mp3', filename: '' } }),
    ).toContain('<audio');
    expect(
      r({ kind: 'bot', text: '', media: { kind: 'document', url: '/x/b.pdf', filename: '' } }),
    ).toContain('b.pdf');
  });
});
