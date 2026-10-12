'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import type { MailSignatureResponse } from '@crm/contracts';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { useMailboxes } from '../api/mailboxes';
import { useSignatures } from '../api/composer';
import {
  autoSignature,
  chosenSignature,
  pickable,
  signaturePreviewHtml,
  variablesOf,
  type SignatureChoice,
} from '../lib/signature-view';

/** The signature as it will be added, filled for the sender and cleaned: the page only ever gets HTML that went through the allow-list. */
export function SignaturePreview({
  signature,
  className,
}: {
  signature: MailSignatureResponse;
  className?: string;
}) {
  const { user } = useSession();
  return (
    <div
      data-testid="email-signature-preview"
      dir="auto"
      className={className}
      // Safe: rebuilt by the allow-list sanitiser (no scripts, handlers, styles or unknown tags; links web, mail and phone only).
      dangerouslySetInnerHTML={{ __html: signaturePreviewHtml(signature, variablesOf(user)) }}
    />
  );
}

/**
 * Under the reply box (TW-MAIL-027): which signature goes out. The default is added on its own and shown here; the agent can switch
 * to another signature of the sender or the mailbox, or send none. Hidden when there is nothing to choose.
 */
export function SignaturePicker({
  channelId,
  choice,
  onChange,
  disabled,
}: {
  /** The inbox channel of the conversation: it names the mailbox the reply goes out from. */
  channelId: string;
  choice: SignatureChoice;
  onChange: (next: SignatureChoice) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('email.composer.signature');
  const id = useId();
  const { user } = useSession();
  const mailboxes = useMailboxes();
  const mailbox = mailboxes.data?.data.find((m) => m.channelId === channelId);
  const sigs = useSignatures(mailbox?.id, mailbox !== undefined);
  const list = sigs.data?.data ?? [];
  const options = pickable(list, mailbox?.id, user.id);
  if (options.length === 0) return null;

  const auto = autoSignature(list, mailbox?.id, user.id);
  const shown = chosenSignature(choice, list, mailbox?.id, user.id);
  const value = choice.kind === 'id' ? choice.id : choice.kind;

  return (
    <div data-testid="email-signature" className="mx-3 mt-2 space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-muted-foreground">
          {t('label')}
        </label>
        <select
          id={id}
          data-testid="email-signature-select"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            onChange(
              v === 'auto'
                ? { kind: 'auto' }
                : v === 'none'
                  ? { kind: 'none' }
                  : { kind: 'id', id: v },
            );
          }}
          className="h-8 min-w-0 max-w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <option value="auto">{auto ? t('auto', { name: auto.name }) : t('autoNone')}</option>
          <option value="none">{t('none')}</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.scope === 'user' ? 'mine' : 'shared', { name: s.name })}
            </option>
          ))}
        </select>
      </div>
      {shown ? (
        <div className="max-h-28 overflow-y-auto rounded-md border border-dashed border-border px-2.5 py-1.5 text-muted-foreground">
          <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide">{t('preview')}</p>
          <SignaturePreview signature={shown} className="[&_a]:text-primary [&_a]:underline" />
        </div>
      ) : (
        <p className="text-muted-foreground" data-testid="email-signature-none">
          {t('noneShown')}
        </p>
      )}
    </div>
  );
}
