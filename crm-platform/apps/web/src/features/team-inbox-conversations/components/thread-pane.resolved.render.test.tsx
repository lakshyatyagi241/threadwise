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

function render(status: string, over: { resolve?: boolean; reply?: boolean } = {}) {
  const props = {
    conversationId: id(1),
    detail: detail({ status } as never),
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

describe('the message input of a resolved thread', () => {
  it.each(['resolved', 'closed'])('is gone for a %s thread, with a way to reopen it', (status) => {
    const out = render(status);
    expect(out).toContain('data-testid="inbox-resolved-bar"');
    expect(out).toContain('This conversation is resolved. Reopen it to reply.');
    expect(out).toContain('data-testid="inbox-resolved-reopen"');
    expect(out).not.toContain('<textarea');
    expect(out).not.toContain('inbox-send');
    expect(out).not.toContain('inbox-mode-note');
  });

  it('keeps the explanation but offers no reopen button to someone who may not resolve', () => {
    const out = render('resolved', { resolve: false });
    expect(out).toContain('data-testid="inbox-resolved-bar"');
    expect(out).not.toContain('inbox-resolved-reopen');
    expect(out).not.toContain('<textarea');
  });

  it('shows the explanation to a read-only viewer too, and no composer', () => {
    const out = render('resolved', { reply: false, resolve: false });
    expect(out).toContain('data-testid="inbox-resolved-bar"');
    expect(out).not.toContain('<textarea');
  });

  it.each(['open', 'pending', 'snoozed'])('is unchanged for a %s thread', (status) => {
    const out = render(status);
    expect(out).not.toContain('inbox-resolved-bar');
    expect(out).toContain('<textarea');
  });
});
