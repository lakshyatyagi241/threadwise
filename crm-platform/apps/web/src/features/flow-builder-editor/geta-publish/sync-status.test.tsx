import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GetaPublishStatus } from './sync-status';
import type { GetaView } from './status-model';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'flow-builder-editor.geta.json'), 'utf8'),
) as Record<string, unknown>;

const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      {el}
    </NextIntlClientProvider>,
  );
const render = (view: GetaView, retrying = false) =>
  html(<GetaPublishStatus view={view} retrying={retrying} onRetry={() => undefined} />);

describe('Geta status beside the Published badge', () => {
  it('renders nothing when hidden', () => {
    expect(render({ kind: 'hidden' })).toBe('');
  });

  it('going live', () => {
    const out = render({ kind: 'pending' });
    expect(out).toContain('Going live…');
    expect(out).toContain('data-state="pending"');
    expect(out).toContain('aria-live="polite"');
  });

  it('live', () => {
    const out = render({ kind: 'live' });
    expect(out).toContain('>Live<');
    expect(out).toContain('data-state="live"');
    expect(out).not.toContain('Retry');
  });

  it('failed at configuration update: names the step, shows the reason and a Retry button', () => {
    const out = render({
      kind: 'failed',
      failedStep: 'configuration_update',
      reason: 'Geta answered 500: console down (configuration update)',
    });
    expect(out).toContain('Failed at configuration update');
    expect(out).toContain('Retry');
    expect(out).toContain('Geta answered 500: console down (configuration update)');
    expect(out).toContain('data-testid="geta-reason"');
    expect(out).toContain('The flow is still published here.');
    expect(out).not.toContain('Live<');
  });

  it('failed at publish names the other step', () => {
    const out = render({ kind: 'failed', failedStep: 'publish_bot', reason: null });
    expect(out).toContain('Failed at publish');
    expect(out).not.toContain('data-testid="geta-reason"');
  });

  it('a failure with no step is plain Failed, and a retry in flight disables the button', () => {
    const out = render({ kind: 'failed', failedStep: null, reason: 'x' }, true);
    expect(out).toContain('>Failed');
    expect(out).toContain('Retrying…');
    expect(out).toMatch(/<button[^>]*disabled/);
  });

  it('no credentials: the exact setup message with a link to the settings page', () => {
    const out = render({ kind: 'not_configured' });
    expect(out).toContain('Published here; set up Geta publishing in settings to push it live.');
    expect(out).toContain('href="/flows/geta-publishing"');
    expect(out).toContain('data-state="not_configured"');
    expect(out).toContain('Dismiss');
  });

  it('published but never pushed offers Push live', () => {
    const out = render({ kind: 'push' });
    expect(out).toContain('Push live');
    expect(out).toContain('data-state="push"');
  });
});
