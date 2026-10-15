import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/features/flow-builder-editor/test-utils/intl';
import { AiStudioScreen } from './ai-studio-screen';

const can = vi.hoisted(() => ({ rights: new Set<string>() }));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (right: string) => can.rights.has(right),
}));

const hrefOf = (html: string, text: string): string | null => {
  const m = new RegExp(`<a[^>]*href="([^"]*)"[^>]*>${text}</a>`).exec(html);
  return m ? m[1]! : null;
};

describe('AI Studio', () => {
  beforeEach(() => {
    can.rights = new Set(['aiag.training.create', 'flb.flows.create']);
  });

  it('starts an AI agent, a website chat bot, a WhatsApp bot and a workflow, each on its own screen', () => {
    const html = renderIntl(<AiStudioScreen />);
    expect(hrefOf(html, 'Create an AI agent')).toBe('/ai-training/create');
    expect(hrefOf(html, 'Your AI agents')).toBe('/ai-training');
    expect(hrefOf(html, 'Website chat bot')).toBe('/flows/simple?type=web');
    expect(hrefOf(html, 'WhatsApp bot')).toBe('/flows/simple');
    expect(hrefOf(html, 'Create a workflow')).toBe('/flows/builder');
    expect(hrefOf(html, 'Your flows')).toBe('/flows');
  });

  it('shows a note instead of links for a start the person has no right to', () => {
    can.rights = new Set(['flb.flows.create']);
    const html = renderIntl(<AiStudioScreen />);
    expect(hrefOf(html, 'Create an AI agent')).toBeNull();
    expect(html).toContain('You do not have the right to start this one');
    expect(hrefOf(html, 'Website chat bot')).toBe('/flows/simple?type=web');
  });
});
