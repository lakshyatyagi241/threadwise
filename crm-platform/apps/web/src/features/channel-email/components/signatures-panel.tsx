'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  MAIL_SIGNATURE_HTML_MAX,
  type MailSignatureResponse,
  type MailSignatureScope,
} from '@crm/contracts';
import { Alert, Button, Spinner } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { useMailboxes } from '../api/mailboxes';
import {
  useAllSignatures,
  useCreateSignature,
  useDeleteSignature,
  useUpdateSignature,
} from '../api/composer';
import { isBlankHtml, sanitizeHtml } from '../lib/rich-text';
import { canEditSignature } from '../lib/signature-view';
import { RichEditor } from './rich-editor';
import { SignaturePreview } from './signature-picker';

interface Draft {
  /** Null while creating. */
  id: string | null;
  rowVersion: number;
  scope: MailSignatureScope;
  mailboxId: string;
  name: string;
  html: string;
  isDefault: boolean;
}

const blank = (scope: MailSignatureScope, mailboxId: string): Draft => ({
  id: null,
  rowVersion: 0,
  scope,
  mailboxId,
  name: '',
  html: '',
  isDefault: false,
});

/**
 * Email signatures (TW-MAIL-027), mounted on the email hub: the shared signature of a mailbox, and each agent's own. Everyone with the
 * right to manage signatures keeps their own; the shared ones of a mailbox need the right to manage mailboxes too. The text may use
 * {{name}}, {{title}} and {{phone}}, filled from the person who sends.
 */
export function SignaturesPanel() {
  const t = useTranslations('email.signatures');
  const { user } = useSession();
  const canSign = useCan('mail.signatures.manage');
  const canMailboxes = useCan('mail.mailboxes.manage');
  const list = useAllSignatures();
  const mailboxes = useMailboxes();
  const create = useCreateSignature();
  const update = useUpdateSignature();
  const remove = useDeleteSignature();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const boxes = (mailboxes.data?.data ?? []).filter(
    (m) => canMailboxes || (m.scope === 'personal' && m.ownerUserId === user.id),
  );
  const boxName = (id: string | null) =>
    mailboxes.data?.data.find((m) => m.id === id)?.address ?? '';
  const who = { userId: user.id, canManageSignatures: canSign, canManageMailboxes: canMailboxes };
  const items = list.data?.data ?? [];
  const saving = create.isPending || update.isPending;

  const fail = (e: unknown) =>
    setProblem(e instanceof ApiError && e.isRowVersionConflict ? t('changed') : t('failed'));

  const nameMissing = draft !== null && draft.name.trim() === '';
  const tooLong = draft !== null && draft.html.length > MAIL_SIGNATURE_HTML_MAX;
  const mailboxMissing = draft?.scope === 'mailbox' && draft.mailboxId === '';

  async function save() {
    if (!draft) return;
    setTried(true);
    if (nameMissing || tooLong || mailboxMissing) return;
    setProblem(null);
    const bodyHtml = isBlankHtml(draft.html) ? '' : sanitizeHtml(draft.html);
    try {
      if (draft.id) {
        await update.mutateAsync({
          id: draft.id,
          body: {
            name: draft.name.trim(),
            bodyHtml,
            isDefault: draft.isDefault,
            rowVersion: draft.rowVersion,
          },
        });
      } else {
        await create.mutateAsync({
          scope: draft.scope,
          ...(draft.scope === 'mailbox' ? { mailboxId: draft.mailboxId } : {}),
          name: draft.name.trim(),
          bodyHtml,
          bodyText: '',
          isDefault: draft.isDefault,
        });
      }
      setDraft(null);
      setTried(false);
    } catch (e) {
      fail(e);
    }
  }

  async function del(s: MailSignatureResponse) {
    setProblem(null);
    try {
      await remove.mutateAsync(s.id);
      setConfirm(null);
    } catch (e) {
      fail(e);
    }
  }

  const field =
    'h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <section
      aria-labelledby="email-signatures-title"
      data-testid="email-signatures"
      className="rounded-lg border border-border bg-background p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="email-signatures-title" className="text-base font-semibold">
            {t('title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        {canSign && !draft && (
          <Button
            data-testid="email-signature-new"
            onClick={() => {
              setProblem(null);
              setTried(false);
              setDraft(blank('user', ''));
            }}
          >
            {t('new')}
          </Button>
        )}
      </div>

      {problem && (
        <Alert tone="danger" className="mt-3">
          {problem}
        </Alert>
      )}

      {draft && (
        <form
          data-testid="email-signature-form"
          className="mt-4 space-y-3 rounded-md border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3 className="text-sm font-semibold">{draft.id ? t('edit') : t('new')}</h3>
          {!draft.id && (
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="mb-1 text-xs text-muted-foreground">{t('scope')}</legend>
              {(['user', 'mailbox'] as const).map((s) => (
                <label key={s} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="email-signature-scope"
                    data-testid={`email-signature-scope-${s}`}
                    checked={draft.scope === s}
                    disabled={s === 'mailbox' && boxes.length === 0}
                    onChange={() => setDraft({ ...draft, scope: s })}
                  />
                  {t(`scopes.${s}`)}
                </label>
              ))}
            </fieldset>
          )}
          {draft.scope === 'mailbox' && !draft.id && (
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">{t('mailbox')}</span>
              <select
                data-testid="email-signature-mailbox"
                value={draft.mailboxId}
                onChange={(e) => setDraft({ ...draft, mailboxId: e.target.value })}
                aria-invalid={tried && mailboxMissing}
                className={field}
              >
                <option value="">{t('pickMailbox')}</option>
                {boxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.address}
                  </option>
                ))}
              </select>
              {tried && mailboxMissing && (
                <span role="alert" className="text-xs text-danger">
                  {t('mailboxRequired')}
                </span>
              )}
            </label>
          )}
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">{t('name')}</span>
            <input
              type="text"
              data-testid="email-signature-name"
              value={draft.name}
              maxLength={80}
              dir="auto"
              aria-invalid={tried && nameMissing}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className={field}
            />
            {tried && nameMissing && (
              <span role="alert" className="text-xs text-danger">
                {t('nameRequired')}
              </span>
            )}
          </label>
          <div>
            <span className="mb-1 block text-xs text-muted-foreground">{t('body')}</span>
            <RichEditor
              initialHtml={draft.html}
              resetKey={draft.id ?? 'new'}
              onChange={(html) => setDraft((d) => (d ? { ...d, html } : d))}
              label={t('body')}
              placeholder={t('bodyPlaceholder')}
              testId="email-signature-editor"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t('variables', { name: '{{name}}', title: '{{title}}', phone: '{{phone}}' })}
            </p>
            {tried && tooLong && (
              <p role="alert" className="text-xs text-danger">
                {t('tooLong')}
              </p>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="email-signature-default"
              checked={draft.isDefault}
              onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })}
            />
            {t(draft.scope === 'user' ? 'defaultUser' : 'defaultMailbox')}
          </label>
          <div className="flex gap-2">
            <Button type="submit" data-testid="email-signature-save" disabled={saving}>
              {saving && <Spinner />} {t('save')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDraft(null)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}

      <div className="mt-4">
        {list.isPending ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> {t('loading')}
          </p>
        ) : list.isError ? (
          <Alert tone="danger">{t('loadError')}</Alert>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((s) => {
              const editable = canEditSignature(s, who);
              return (
                <li
                  key={s.id}
                  data-testid="email-signature-row"
                  className="rounded-md border border-border p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span dir="auto" className="min-w-0 break-words text-sm font-medium">
                      {s.name}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {s.scope === 'user'
                        ? t('scopes.userBadge')
                        : boxName(s.mailboxId) || t('scopes.mailboxBadge')}
                    </span>
                    {s.isDefault && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary">
                        {t('default')}
                      </span>
                    )}
                    {editable && (
                      <span className="ms-auto flex gap-2 text-xs">
                        <button
                          type="button"
                          data-testid="email-signature-edit"
                          className="rounded underline focus-visible:ring-2 focus-visible:ring-primary"
                          onClick={() => {
                            setProblem(null);
                            setTried(false);
                            setDraft({
                              id: s.id,
                              rowVersion: s.rowVersion,
                              scope: s.scope,
                              mailboxId: s.mailboxId ?? '',
                              name: s.name,
                              html: s.bodyHtml,
                              isDefault: s.isDefault,
                            });
                          }}
                        >
                          {t('editShort')}
                        </button>
                        {confirm === s.id ? (
                          <>
                            <button
                              type="button"
                              data-testid="email-signature-confirm-delete"
                              className="rounded font-medium text-danger underline focus-visible:ring-2 focus-visible:ring-danger"
                              onClick={() => void del(s)}
                            >
                              {t('confirmDelete')}
                            </button>
                            <button
                              type="button"
                              className="rounded underline"
                              onClick={() => setConfirm(null)}
                            >
                              {t('cancel')}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            data-testid="email-signature-delete"
                            className="rounded text-danger underline focus-visible:ring-2 focus-visible:ring-danger"
                            onClick={() => setConfirm(s.id)}
                          >
                            {t('delete')}
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  <SignaturePreview
                    signature={s}
                    className="mt-1.5 max-h-24 overflow-y-auto text-sm text-muted-foreground [&_a]:text-primary [&_a]:underline"
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {!canSign && <p className="mt-3 text-xs text-muted-foreground">{t('noPermission')}</p>}
    </section>
  );
}
