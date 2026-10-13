import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { ConversationCloudGroup } from '@crm/contracts';
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

const group = (over: Partial<ConversationCloudGroup> = {}): ConversationCloudGroup => ({
  groupId: 'Y2FwaV9ncm91cDoxMjM0NTY3ODkwMTIzNDU2',
  subject: 'Neighbours',
  memberCount: 8,
  suspended: false,
  block: null,
  canSend: true,
  estimate: { minor: 800, currency: 'USD' },
  walletShort: false,
  ...over,
});

const PERMS = { 'inbox.conversations.read': 'all' } as const;

function render(
  over: {
    kind?: string;
    peerKey?: string;
    cloudGroup?: ConversationCloudGroup | null;
    reply?: boolean;
  } = {},
  perms: Record<string, 'all'> = PERMS,
) {
  const d = detail({
    peerKey: over.peerKey ?? 'g:Y2FwaV9ncm91cDoxMjM0NTY3ODkwMTIzNDU2',
    title: 'Neighbours',
    channel: { id: id(900), kind: over.kind ?? 'whatsapp_cloud', name: 'Sales line' },
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
    ...(over.cloudGroup !== undefined ? { cloudGroup: over.cloudGroup } : {}),
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
    can: { reply: over.reply ?? true, note: true, resolve: true, assignSelf: true },
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

describe('a Meta Cloud API group thread in the thread pane (phase 3)', () => {
  it('has a working composer with the member count and the estimated cost for the whole group', () => {
    const out = render({ cloudGroup: group() });
    expect(out).not.toMatch(DISABLED_TEXTAREA);
    expect(out).not.toContain('inbox-group-send-unavailable');
    expect(out).not.toContain('inbox-group-cloud-block');
    expect(out).toContain('data-testid="inbox-group-cost"');
    expect(out).toContain('This message goes to 8 members.');
    expect(out).toContain('Estimated cost $8.00');
    expect(out).toContain('WhatsApp bills each member who receives it');
    expect(out).not.toContain('inbox-group-wallet-short');
  });

  it('uses the singular for one member, and says so when the size is not known yet', () => {
    expect(
      render({ cloudGroup: group({ memberCount: 1, estimate: { minor: 100, currency: 'USD' } }) }),
    ).toContain('This message goes to 1 member.');
    const unknown = render({ cloudGroup: group({ memberCount: 0, estimate: null }) });
    expect(unknown).toContain('The member count is not known yet');
    expect(unknown).not.toContain('Estimated cost');
  });

  it('drops the figure but keeps the member count when no estimate can be worked out', () => {
    const out = render({ cloudGroup: group({ estimate: null }) });
    expect(out).toContain('This message goes to 8 members. WhatsApp bills');
    expect(out).not.toContain('Estimated cost');
  });

  it('warns about a short wallet without switching the composer off', () => {
    const out = render({ cloudGroup: group({ walletShort: true }) });
    expect(out).toContain('data-testid="inbox-group-wallet-short"');
    expect(out).toContain('Your wallet may not cover this message');
    expect(out).toContain('data-wallet-short="true"');
    expect(out).not.toMatch(DISABLED_TEXTAREA);
  });

  it.each([
    [
      'suspended',
      'Meta suspended this group',
      'WhatsApp does not deliver messages to a suspended group',
    ],
    [
      'plan',
      'Your plan does not include WhatsApp Groups',
      'sending to the group needs a plan with Groups',
    ],
    ['ineligible', 'This number cannot use WhatsApp Groups', 'Official Business Account'],
  ] as const)(
    'is off for %s: the reason is shown, the box is disabled, notes still work, and there is no cost line',
    (block, title, message) => {
      const out = render({
        cloudGroup: group({
          block,
          canSend: false,
          suspended: block === 'suspended',
          estimate: null,
        }),
      });
      expect(out).toContain('data-testid="inbox-group-cloud-block"');
      expect(out).toContain(`data-reason="${block}"`);
      expect(out).toContain(title);
      expect(out).toContain(message);
      expect(out).toMatch(DISABLED_TEXTAREA);
      expect(out).toMatch(/<button[^>]*data-testid="inbox-send"[^>]*\sdisabled=""/);
      expect(out).toContain('inbox-mode-note');
      expect(out).not.toContain('inbox-group-cost');
      // The line under the box names the reason, not the old "not available yet".
      expect(out).toContain('data-testid="inbox-group-send-unavailable"');
      expect(out).not.toContain('Sending to WhatsApp groups is not available yet');
    },
  );

  it('shows neither the cost line nor the block to a person who may not reply (they see the read-only line)', () => {
    const out = render({ cloudGroup: group({ block: 'plan', canSend: false }), reply: false });
    expect(out).not.toContain('inbox-group-cloud-block');
    expect(out).not.toContain('inbox-group-cost');
  });

  it('is not blocked while the state is not known yet (the API refuses what it cannot send)', () => {
    const out = render({ cloudGroup: undefined });
    expect(out).not.toContain('inbox-group-cloud-block');
    expect(out).not.toContain('inbox-group-cost');
    expect(out).not.toMatch(DISABLED_TEXTAREA);
  });

  it('keeps the Cloud API group limits: no place, contact cards or buttons, no Open group link', () => {
    const out = render({ cloudGroup: group() });
    expect(out).not.toContain('inbox-share');
    expect(out).not.toContain('inbox-open-group');
  });

  it('a one-to-one thread on the same channel shows no group controls', () => {
    const out = render({ peerKey: '919876543210', cloudGroup: null });
    expect(out).not.toContain('inbox-group-cost');
    expect(out).not.toContain('inbox-group-cloud-block');
  });
});
