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

const ME = id(10);
const OTHER = id(11);
const LOCK = 'This chat is assigned to another agent. Assign it to yourself first to reply.';

function render(
  assigneeId: string | null,
  over: { assignSelf?: boolean; mode?: 'reply' | 'note'; teamOnly?: boolean } = {},
) {
  const d = detail({
    assignment: {
      user: assigneeId ? { id: assigneeId, name: 'Someone' } : null,
      team: over.teamOnly ? { id: id(5), name: 'Support', color: null } : null,
      aiAgent: null,
    },
  });
  const props = {
    conversationId: id(1),
    detail: d,
    fetchedAt: 0,
    detailPending: false,
    notFound: false,
    thread,
    notes: [],
    channel: undefined,
    nowMs: 0,
    can: { reply: true, note: true, resolve: true, assignSelf: over.assignSelf ?? true },
    mode: over.mode ?? 'reply',
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
    assignMenu: { meId: ME, canAssign: false, busy: false, onAssign: noop },
    onRetryDetail: noop,
  } as unknown as ThreadPaneProps;
  return renderAccount(
    <ToastProvider dismissLabel="x">
      <ThreadPane {...props} />
    </ToastProvider>,
    { session: makeSession({ permissions: { 'inbox.conversations.read': 'all' } as never }) },
  );
}

const DISABLED_TEXTAREA = /<textarea[^>]*\sdisabled=""/;

describe('a chat assigned to another agent', () => {
  it('locks the reply box, disables send and says why', () => {
    const out = render(OTHER);
    expect(out).toContain('data-testid="inbox-assigned-lock"');
    expect(out).toContain(LOCK);
    expect(out).toMatch(DISABLED_TEXTAREA);
    expect(out).toMatch(/<button[^>]*data-testid="inbox-send"[^>]*\sdisabled=""/);
    expect(out).toContain(`placeholder="${LOCK}"`);
  });

  it('offers Assign to me when the viewer may assign themselves', () => {
    expect(render(OTHER)).toContain('inbox-assigned-lock-assign');
    expect(render(OTHER, { assignSelf: false })).not.toContain('inbox-assigned-lock-assign');
  });

  it('does not lock the assignee, an unassigned chat or a team-only assignment', () => {
    for (const out of [render(ME), render(null), render(null, { teamOnly: true })]) {
      expect(out).not.toContain('data-testid="inbox-assigned-lock"');
      expect(out).not.toMatch(DISABLED_TEXTAREA);
    }
  });

  it('keeps internal notes open', () => {
    const out = render(OTHER, { mode: 'note' });
    expect(out).not.toContain('data-testid="inbox-assigned-lock"');
    expect(out).not.toMatch(DISABLED_TEXTAREA);
  });
});
