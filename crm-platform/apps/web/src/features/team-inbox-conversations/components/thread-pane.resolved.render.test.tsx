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
  over: { resolve?: boolean; reply?: boolean; channelKind?: string } = {},
) {
  const channel = { id: id(900), kind: over.channelKind ?? 'simulator', name: 'Site' };
  const props = {
    conversationId: id(1),
    detail: detail({ status, channel } as never),
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
      priority: true,
      snooze: true,
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
    triage: { busy: false, onPriority: noop, onSnooze: noop, onWake: noop, onSpam: noop },
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

  it('offers no reopen anywhere for a resolved or closed web chat: no header toggle, no bar button', () => {
    for (const status of ['resolved', 'closed']) {
      const out = render(status, { channelKind: 'webchat' });
      expect(out).toContain('data-testid="inbox-resolved-bar"');
      expect(out).toContain('This web chat is resolved and cannot be reopened.');
      expect(out).not.toContain('inbox-resolved-reopen');
      expect(out).not.toContain('data-testid="inbox-resolve"');
      expect(out).not.toContain('<textarea');
    }
  });

  it('offers no snooze or spam for a resolved web chat, and keeps the other header controls', () => {
    const out = render('resolved', { channelKind: 'webchat' });
    expect(out).not.toContain('data-testid="inbox-snooze"');
    expect(out).not.toContain('data-testid="inbox-spam"');
    expect(out).not.toContain('data-testid="inbox-not-spam"');
    expect(out).toContain('data-testid="inbox-priority"');
  });

  it('keeps reopen for a resolved conversation on any other channel', () => {
    const out = render('resolved', { channelKind: 'whatsapp_cloud' });
    expect(out).toContain('data-testid="inbox-resolved-reopen"');
    expect(out).toContain('This conversation is resolved. Reopen it to reply.');
    expect(out).toContain('data-testid="inbox-resolve"');
    expect(out).toContain('data-testid="inbox-snooze"');
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
