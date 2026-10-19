import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';
import { detail, id } from '../lib/fixtures';
import { EMPTY_THREAD } from '../lib/thread';
import type { Thread } from '../api/use-thread';
import { ThreadPane, type ThreadPaneProps } from './thread-pane';

vi.mock('@/features/calling-voice', () => ({ CallButton: () => null }));

const noop = () => undefined;
const asyncNoop = () => Promise.resolve();

const thread = {
  state: { ...EMPTY_THREAD, conversationId: id(1), loaded: true },
  room: 'joined',
  loadOlder: asyncNoop,
  olderLoading: false,
  send: noop,
  react: asyncNoop,
  sendTemplate: asyncNoop,
  sendShare: asyncNoop,
  retryPending: noop,
  dismissPending: noop,
  retryMessage: asyncNoop,
  sync: asyncNoop,
  progress: {},
} as unknown as Thread;

function render(
  status: string,
  over: {
    resolve?: boolean;
    reply?: boolean;
    window?: { open: boolean; expiresAt: string | null };
  } = {},
) {
  const props = {
    conversationId: id(1),
    detail: detail({ status, ...(over.window ? { window: over.window } : {}) } as never),
    fetchedAt: 0,
    detailPending: false,
    notFound: false,
    thread,
    notes: [],
    channel: undefined,
    nowMs: 0,
    can: {
      reply: over.reply ?? true,
      note: true,
      resolve: over.resolve ?? true,
      assignSelf: true,
    },
    mode: 'reply',
    onMode: noop,
    composerRef: null,
    panelOpen: false,
    onTogglePanel: noop,
    onBack: noop,
    onSeenLatest: noop,
    onSend: noop,
    onReact: asyncNoop,
    onNote: () => Promise.resolve(true),
    onDeleteNote: noop,
    canDeleteNote: () => false,
    bottomSignal: 0,
    onToggleResolved: noop,
    onRetryMessage: asyncNoop,
    resolving: false,
    onAssignSelf: noop,
    onRetryDetail: noop,
  } as unknown as ThreadPaneProps;
  return renderAccount(
    <ToastProvider dismissLabel="x">
      <ThreadPane {...props} />
    </ToastProvider>,
    { session: makeSession({ permissions: { 'inbox.conversations.read': 'all' } as never }) },
  );
}

/** The opening tag that carries a test id (React writes `class` before or after it). */
const tagOf = (html: string, testId: string) => {
  const at = html.indexOf(`data-testid="${testId}"`);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at));
};

describe('the thread header at a narrow pane', () => {
  it('wraps instead of overlapping: the name block keeps a minimum width and the buttons sit in their own group', () => {
    const out = render('open', { window: { open: false, expiresAt: null } });
    expect(tagOf(out, 'inbox-thread-header')).toContain('flex-wrap');
    expect(tagOf(out, 'inbox-thread-actions')).toContain('flex-wrap');
    expect(out).toContain('min-w-[12rem]');
  });

  it('never squeezes Resolve to a stub', () => {
    const tag = tagOf(render('open'), 'inbox-resolve');
    expect(tag).toContain('shrink-0');
    expect(tag).toContain('whitespace-nowrap');
  });

  it('says Window closed for a customer who never wrote on a window channel', () => {
    const out = render('open', { window: { open: false, expiresAt: null } });
    expect(tagOf(out, 'inbox-window-badge')).toContain('data-state="closed"');
  });
});
