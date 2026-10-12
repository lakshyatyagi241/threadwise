import { describe, expect, it, vi } from 'vitest';
import type { WebBotItem } from '@crm/contracts';
import { renderIntl } from '@/features/flow-builder-editor/test-utils/intl';
import { WebBotsScreen } from './web-bots-screen';

const state = vi.hoisted(() => ({
  list: { isPending: false, isError: false, data: { data: [], total: 0 } } as {
    isPending: boolean;
    isError: boolean;
    data?: { data: WebBotItem[]; total: number };
  },
  mode: 'simple' as 'simple' | 'advanced',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../api/widgets', () => ({ useWebBots: () => state.list }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { builderMode: state.mode } }),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => true,
}));
vi.mock('@/features/flow-builder-editor/api/flows', () => ({ flowsApi: { overview: () => null } }));
vi.mock('@/features/flow-builder-editor/api/hooks', () => ({ FLB_KEYS: { overview: ['o'] } }));

const bot = (over: Partial<WebBotItem> & { flowId: string }): WebBotItem => ({
  name: 'Pricing bot',
  state: 'live',
  isPublished: true,
  widget: {
    id: 'w-1',
    headerTitle: 'Ask us',
    status: 'active',
    customizedAt: '2026-10-11T00:00:00.000Z',
  },
  updatedAt: '2026-10-11T00:00:00.000Z',
  ...over,
});

describe('Settings > Channels > Web', () => {
  it('lists each bot with its state and links to its Customize and Install tabs', () => {
    state.mode = 'simple';
    state.list = {
      isPending: false,
      isError: false,
      data: {
        total: 2,
        data: [
          bot({ flowId: 'f-live' }),
          bot({ flowId: 'f-new', name: 'Fresh bot', state: 'needs_customizing', widget: null }),
        ],
      },
    };
    const out = renderIntl(<WebBotsScreen />);
    expect(out).toContain('Pricing bot');
    expect(out).toContain('Widget: Ask us');
    expect(out).toContain('>Live<');
    expect(out).toContain('>Needs customizing<');
    expect(out).toContain('href="/flows/simple/f-live?tab=customize"');
    expect(out).toContain('href="/flows/simple/f-live?tab=install"');
    // A bot with no widget has nothing to install yet.
    expect(out).not.toContain('href="/flows/simple/f-new?tab=install"');
    expect(out).toContain('href="/flows/simple/f-new?tab=customize"');
  });

  it('opens the Advanced builder when the workspace uses it, and offers a new website bot', () => {
    state.mode = 'advanced';
    state.list = {
      isPending: false,
      isError: false,
      data: { total: 1, data: [bot({ flowId: 'f1' })] },
    };
    const out = renderIntl(<WebBotsScreen />);
    expect(out).toContain('href="/flows/builder/f1?tab=customize"');
    expect(out).toContain('href="/flows/builder?type=web"');
  });

  it('says so when there are no bots, and when the list is cut', () => {
    state.mode = 'simple';
    state.list = { isPending: false, isError: false, data: { total: 0, data: [] } };
    expect(renderIntl(<WebBotsScreen />)).toContain('No website chat bots yet');
    state.list = {
      isPending: false,
      isError: false,
      data: { total: 250, data: [bot({ flowId: 'f1' })] },
    };
    expect(renderIntl(<WebBotsScreen />)).toContain('Showing 1 of 250 bots');
  });
});
