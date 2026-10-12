import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { ConversationPersonalGroup } from '@crm/contracts';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';
import { detail, id } from '../lib/fixtures';
import { EMPTY_THREAD } from '../lib/thread';
import type { Thread } from '../api/use-thread';
import { ThreadPane, type ThreadPaneProps } from './thread-pane';

// The call button needs the calling provider of the whole shell; it has nothing to do with groups.
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

const group = (over: Partial<ConversationPersonalGroup> = {}): ConversationPersonalGroup => ({
  groupId: '120363025246125486',
  left: false,
  announce: false,
  isAdmin: true,
  announceOnly: false,
  canSend: true,
  memberCount: 12,
  ...over,
});

const PERMS = { 'inbox.conversations.read': 'all', 'wa.groups.read': 'all' } as const;

function render(
  over: { kind?: string; peerKey?: string; personalGroup?: ConversationPersonalGroup | null } = {},
  perms: Record<string, 'all'> = PERMS,
) {
  const d = detail({
    peerKey: over.peerKey ?? 'g:120363025246125486',
    title: 'VIP customers',
    channel: { id: id(900), kind: over.kind ?? 'whatsapp_qr', name: 'Sales line' },
    capabilities: {
      windowHours: null,
      templates: false,
      media: ['image', 'document', 'audio', 'video', 'location', 'contact'],
      reactions: true,
      editDelete: false,
      receipts: ['sent', 'delivered', 'read'],
      typing: false,
    },
    window: { open: true, expiresAt: null },
    ...(over.personalGroup !== undefined ? { personalGroup: over.personalGroup } : {}),
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
    can: { reply: true, note: true, resolve: true, assignSelf: true },
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
    {
      session: makeSession({ permissions: perms as never }),
    },
  );
}

const DISABLED_TEXTAREA = /<textarea[^>]*\sdisabled=""/;

describe('a group thread of a personal number in the thread pane', () => {
  it('has the whole composer, the file input and a link back to the Groups tab', () => {
    const out = render({ personalGroup: group() });
    expect(out).not.toMatch(DISABLED_TEXTAREA);
    expect(out).not.toContain('inbox-group-send-unavailable');
    expect(out).not.toContain('inbox-group-readonly');
    expect(out).toContain('inbox-file-input');
    expect(out).toContain('data-testid="inbox-open-group"');
    expect(out).toContain('href="/devices/groups"');
    expect(out).toContain('Open group');
  });

  it('offers the place and contact-card share, which a Cloud API group does not', () => {
    const qr = render({ personalGroup: group() });
    expect(qr).toContain('inbox-share');
    const cloud = render({ kind: 'whatsapp_cloud', personalGroup: null });
    expect(cloud).not.toContain('inbox-share');
  });

  it('keeps the Open group link off a thread the person may not follow to the Groups tab', () => {
    const out = render({ personalGroup: group() }, { 'inbox.conversations.read': 'all' });
    expect(out).not.toContain('inbox-open-group');
  });

  it('says the number left, switches the box off, and still allows internal notes', () => {
    const out = render({ personalGroup: group({ left: true, canSend: false }) });
    expect(out).toContain('data-testid="inbox-group-readonly"');
    expect(out).toContain('data-reason="left"');
    expect(out).toContain('This number left the group');
    expect(out).toMatch(DISABLED_TEXTAREA);
    expect(out).toMatch(/<button[^>]*data-testid="inbox-send"[^>]*\sdisabled=""/);
    expect(out).toContain('inbox-mode-note');
  });

  it('says only admins may send when announce-only and the number is not an admin', () => {
    const out = render({
      personalGroup: group({ announce: true, isAdmin: false, announceOnly: true, canSend: false }),
    });
    expect(out).toContain('data-reason="announceOnly"');
    expect(out).toContain('Only admins can send in this group');
    expect(out).toMatch(DISABLED_TEXTAREA);
  });

  it('is not read-only for an admin of an announce-only group', () => {
    const out = render({
      personalGroup: group({ announce: true, isAdmin: true, announceOnly: false, canSend: true }),
    });
    expect(out).not.toContain('inbox-group-readonly');
    expect(out).not.toMatch(DISABLED_TEXTAREA);
  });

  it('is not blocked while the flags are not known yet (the API refuses what it cannot send)', () => {
    const out = render({ personalGroup: undefined });
    expect(out).not.toContain('inbox-group-readonly');
    expect(out).not.toMatch(DISABLED_TEXTAREA);
  });

  it('a one-to-one thread on the same channel shows no group controls', () => {
    const out = render({ peerKey: '919876543210', personalGroup: null });
    expect(out).not.toContain('inbox-open-group');
    expect(out).not.toContain('inbox-group-readonly');
  });

  it('still turns the reply box off on a group of a channel that cannot send to one', () => {
    const out = render({ kind: 'telegram', personalGroup: null });
    expect(out).toContain('data-testid="inbox-group-send-unavailable"');
    expect(out).toMatch(DISABLED_TEXTAREA);
  });
});
