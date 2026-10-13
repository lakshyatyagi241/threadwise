import { describe, expect, it, vi } from 'vitest';
import type { MailSignatureResponse, MailboxResponse } from '@crm/contracts';
import { KEYS } from '../api/mailboxes';
import { COMPOSER_KEYS } from '../api/composer';
import type { StagedFile } from '../lib/staged-attachments';
import { AttachmentTray } from './attachment-tray';
import { RichEditor } from './rich-editor';
import { SignaturePicker } from './signature-picker';
import { SignaturesPanel } from './signatures-panel';
import { render } from './render-utils';

const ME = '9a6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f99';
const OTHER = '1a6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f11';
const MB = '0b6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f50';
const CHANNEL = '5d2c7a10-1b2c-4e3d-8f4a-0a1b2c3d4e5f';
let perms: Record<string, boolean> = { 'mail.signatures.manage': true };

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (key: string) => perms[key] === true,
  useSession: () => ({
    user: { id: ME, fullName: 'Ada Lovelace', displayName: null, phone: '+44 20 7946 0000' },
  }),
}));

const mailbox = {
  id: MB,
  provider: 'google',
  address: 'support@acme.com',
  displayName: 'Acme',
  status: 'connected',
  scope: 'shared',
  ownerUserId: null,
  ownerName: null,
  hasSignature: true,
  pushActive: false,
  sendLimitPerHour: null,
  imap: null,
  channelId: CHANNEL,
  connectedAt: null,
  lastSyncedAt: null,
  lastError: null,
  conversationCount: 0,
  rowVersion: 1,
} as MailboxResponse;
const mailboxes = { data: [mailbox], limit: 3, used: 1, providerReady: true };

const sig = (id: string, p: Partial<MailSignatureResponse>): MailSignatureResponse => ({
  id,
  scope: 'user',
  mailboxId: null,
  userId: ME,
  name: id,
  bodyHtml: '<p>{{name}} | {{phone}}</p>',
  bodyText: '',
  isDefault: false,
  rowVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...p,
});

const staged = (p: Partial<StagedFile>): StagedFile => ({
  key: 'k',
  name: 'plan.pdf',
  size: 2048,
  mime: 'application/pdf',
  status: 'ready',
  progress: 100,
  id: 'x',
  error: null,
  file: null,
  ...p,
});

const tray = (
  files: StagedFile[],
  refusals: Parameters<typeof AttachmentTray>[0]['refusals'] = [],
) =>
  render(
    <AttachmentTray
      files={files}
      refusals={refusals}
      onRemove={() => undefined}
      onRetry={() => undefined}
      onDismissRefusals={() => undefined}
    />,
  );

describe('attachment tray', () => {
  it('renders nothing when empty', () => {
    expect(tray([])).not.toContain('email-attach-tray');
  });

  it('shows name, size, progress while uploading and Attached when done', () => {
    const html = tray([
      staged({ key: 'a', status: 'uploading', progress: 40, id: null }),
      staged({ key: 'b', name: 'b.txt' }),
    ]);
    expect(html).toContain('plan.pdf');
    expect(html).toContain('2.0 KB');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain('Attached');
  });

  it('names the reason of a failed upload by its code and offers Retry only while the file is kept', () => {
    const failed = staged({
      status: 'failed',
      error: 'MAIL_ATTACHMENT_TOO_LARGE',
      id: null,
      file: new File(['x'], 'plan.pdf'),
    });
    const html = tray([failed]);
    expect(html).toContain('A file is too large to attach');
    expect(html).toContain('data-testid="email-attach-retry"');
    expect(tray([{ ...failed, file: null }])).not.toContain('email-attach-retry');
  });

  it('says why a file was refused before the upload', () => {
    const html = tray(
      [],
      [
        { name: 'big.zip', reason: 'tooLarge' },
        { name: 'run.exe', reason: 'blocked' },
      ],
    );
    expect(html).toContain('big.zip is larger than 10.0 MB');
    expect(html).toContain('run.exe is a file type that email cannot carry');
  });

  it('shows the file names as text, never as markup', () => {
    const html = tray([staged({ name: '<img src=x onerror=alert(1)>.pdf' })]);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('rich editor', () => {
  it('renders the toolbar and an editable box with the placeholder', () => {
    const html = render(
      <RichEditor
        initialHtml=""
        resetKey="1"
        onChange={() => undefined}
        label="Email reply"
        placeholder="Write a reply"
      />,
    );
    expect(html).toContain('role="toolbar"');
    for (const id of ['bold', 'italic', 'underline', 'ul', 'ol', 'quote', 'link', 'clear']) {
      expect(html).toContain(`data-testid="email-editor-${id}"`);
    }
    expect(html).toContain('role="textbox"');
    expect(html).toContain('data-placeholder="Write a reply"');
  });

  it('turns the toolbar off with the box when disabled', () => {
    const html = render(
      <RichEditor
        initialHtml=""
        resetKey="1"
        onChange={() => undefined}
        label="x"
        placeholder="y"
        disabled
      />,
    );
    expect(html).toContain('contentEditable="false"');
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(8);
  });
});

describe('signature picker', () => {
  const seed = (list: MailSignatureResponse[]) =>
    [
      [KEYS.mailboxes, mailboxes],
      [[...COMPOSER_KEYS.signatures, MB], { data: list }],
    ] as const;
  const picker = (
    list: MailSignatureResponse[],
    choice: Parameters<typeof SignaturePicker>[0]['choice'] = { kind: 'auto' },
  ) =>
    render(<SignaturePicker channelId={CHANNEL} choice={choice} onChange={() => undefined} />, {
      seed: seed(list),
    });

  it('is hidden when there is nothing to choose', () => {
    expect(picker([])).not.toContain('email-signature');
    expect(picker([sig('theirs', { userId: OTHER })])).not.toContain('email-signature');
  });

  it('shows the default, filled with the sender details, and the choices', () => {
    const html = picker([
      sig('Mine', { isDefault: true }),
      sig('Shared', { scope: 'mailbox', userId: null, mailboxId: MB }),
    ]);
    expect(html).toContain('Default (Mine)');
    expect(html).toContain('Ada Lovelace | +44 20 7946 0000');
    expect(html).toContain('Shared (mailbox)');
    expect(html).toContain('No signature');
  });

  it('says nothing is added when none is chosen', () => {
    const html = picker([sig('Mine', { isDefault: true })], { kind: 'none' });
    expect(html).toContain('No signature will be added.');
    expect(html).not.toContain('Ada Lovelace');
  });

  it('renders signature HTML safely: no scripts, handlers, styles or javascript links', () => {
    const html = picker([
      sig('Evil', {
        isDefault: true,
        bodyHtml:
          '<p onclick="x()">Hi</p><script>alert(1)</script><img src=x onerror=alert(2)><a href="javascript:alert(3)">l</a><style>*{}</style>{{name}}',
      }),
    ]);
    const preview = html.slice(html.indexOf('data-testid="email-signature-preview"'));
    expect(preview).toContain('Hi');
    expect(preview).not.toMatch(/<script|<img|<style|onclick|onerror|javascript:/i);
  });
});

describe('signatures panel', () => {
  const panel = (list: MailSignatureResponse[]) =>
    render(<SignaturesPanel />, {
      seed: [
        [KEYS.mailboxes, mailboxes],
        [[...COMPOSER_KEYS.signatures, 'all'], { data: list }],
      ],
    });
  const list = [
    sig('Mine', { isDefault: true }),
    sig('Colleague', { userId: OTHER }),
    sig('Shared', { scope: 'mailbox', userId: null, mailboxId: MB }),
  ];

  it('lets an agent change only their own user signatures', () => {
    perms = { 'mail.signatures.manage': true };
    const html = panel(list);
    expect(html.match(/data-testid="email-signature-row"/g)).toHaveLength(3);
    expect(html.match(/data-testid="email-signature-edit"/g)).toHaveLength(1);
    expect(html).toContain('data-testid="email-signature-new"');
    expect(html).toContain('support@acme.com');
  });

  it('lets a mailbox manager also change the shared one', () => {
    perms = { 'mail.signatures.manage': true, 'mail.mailboxes.manage': true };
    expect(panel(list).match(/data-testid="email-signature-edit"/g)).toHaveLength(2);
  });

  it('is read-only without the permission', () => {
    perms = {};
    const html = panel(list);
    expect(html).not.toContain('email-signature-edit');
    expect(html).not.toContain('email-signature-new');
    expect(html).toContain('You do not have permission to manage signatures.');
  });
});
