'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import {
  CHANNEL_KINDS,
  PLAN_UPGRADE_PATH,
  SAVED_REPLY_BODY_MAX,
  SAVED_REPLY_CATEGORY_MAX,
  SAVED_REPLY_SHORTCUT_MAX,
  SAVED_REPLY_TITLE_MAX,
  SAVED_REPLY_VARIABLES,
  SAVED_REPLY_VARIABLE_GROUPS,
  normalizeShortcut,
  type SavedReply,
} from '@crm/contracts';
import { Alert, Button, Checkbox, Field, Input, Modal, Spinner, Textarea } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { errorCode } from '../lib/errors';
import {
  EMPTY_DRAFT,
  draftOf,
  draftProblems,
  insertAtSelection,
  previewOf,
  toCreateInput,
  toUpdateInput,
  type SavedReplyDraft,
} from '../lib/saved-reply-form';
import { savedRepliesApi } from '../api/saved-replies';
import { useErrorText } from './parts';

export interface SavedReplyFormProps {
  open: boolean;
  /** The reply being edited, or null for a new one. */
  reply: SavedReply | null;
  onClose: () => void;
  /** Called with the saved reply once the server has it. */
  onSaved: (reply: SavedReply, created: boolean) => void;
}

/**
 * New or edit saved reply: shortcut (with the form it will be stored in), title, text with variable chips and a live preview on
 * sample customer data, category, language, the channels it is for and whether it is shared or only mine (fixed once saved, as in
 * Reference). Mounted only while open, so each opening starts from the reply (or empty).
 */
export function SavedReplyForm(props: SavedReplyFormProps) {
  return props.open ? <FormBody {...props} /> : null;
}

function FormBody({ reply, onClose, onSaved }: SavedReplyFormProps) {
  const t = useTranslations('team-inbox-conversations.savedReplies.form');
  const tk = useTranslations('team-inbox-conversations.savedReplies.channelKind');
  const tv = useTranslations('team-inbox-conversations.savedReplies.variable');
  const tg = useTranslations('team-inbox-conversations.savedReplies.variableGroup');
  const errorText = useErrorText();
  const [draft, setDraft] = useState<SavedReplyDraft>(() => (reply ? draftOf(reply) : EMPTY_DRAFT));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ text: string; upgrade: boolean; taken: boolean } | null>(
    null,
  );
  const body = useRef<HTMLTextAreaElement>(null);
  const ids = useId();
  const editing = reply !== null;

  const problems = draftProblems(draft);
  const hasProblems = Object.keys(problems).length > 0;
  const shown = (field: keyof SavedReplyDraft) => (tried ? problems[field] : undefined);
  const stored = normalizeShortcut(draft.shortcut);
  const preview = previewOf(draft.body);

  const set = <K extends keyof SavedReplyDraft>(key: K, value: SavedReplyDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setFailure(null);
  };

  function addVariable(key: string) {
    const el = body.current;
    const at = {
      start: el?.selectionStart ?? draft.body.length,
      end: el?.selectionEnd ?? draft.body.length,
    };
    const next = insertAtSelection(draft.body, at, `{{${key}}}`);
    set('body', next.value);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    });
  }

  async function save() {
    setTried(true);
    if (hasProblems) return;
    setBusy(true);
    setFailure(null);
    try {
      const saved = reply
        ? await savedRepliesApi.update(reply.id, toUpdateInput(draft, reply.rowVersion))
        : await savedRepliesApi.create(toCreateInput(draft));
      onSaved(saved, !reply);
    } catch (e) {
      const code = errorCode(e);
      setFailure({
        text:
          code === 'PLAN_LIMIT_REACHED'
            ? t('planLimit')
            : code === 'ROW_VERSION_CONFLICT'
              ? t('conflict')
              : e instanceof ApiError && code === 'VALIDATION_FAILED'
                ? t('invalid')
                : errorText(e),
        upgrade: code === 'PLAN_LIMIT_REACHED',
        taken: code === 'SAVED_REPLY_SHORTCUT_TAKEN',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      eyebrow={t('eyebrow')}
      title={editing ? t('titleEdit') : t('titleNew')}
      closeLabel={t('close')}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={busy} data-testid="saved-reply-save">
            {busy && <Spinner />}
            {busy ? t('saving') : t('save')}
          </Button>
        </div>
      }
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {failure && (
          <Alert tone="danger">
            {failure.text}
            {failure.upgrade && (
              <>
                {' '}
                <Link href={PLAN_UPGRADE_PATH} className="font-semibold underline">
                  {t('upgrade')}
                </Link>
              </>
            )}
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('shortcut')}
            htmlFor={`${ids}-shortcut`}
            hint={
              stored
                ? t('shortcutStored', { shortcut: stored })
                : t('shortcutHint', { max: SAVED_REPLY_SHORTCUT_MAX })
            }
            error={
              shown('shortcut')
                ? t('shortcutEmpty')
                : failure?.taken
                  ? t('shortcutTaken', { shortcut: stored })
                  : undefined
            }
          >
            <div className="flex items-center gap-1.5" dir="ltr">
              <span aria-hidden="true" className="font-mono text-muted-foreground">
                /
              </span>
              <Input
                id={`${ids}-shortcut`}
                value={draft.shortcut}
                maxLength={200}
                autoComplete="off"
                spellCheck={false}
                invalid={Boolean(shown('shortcut')) || failure?.taken}
                placeholder={t('shortcutPlaceholder')}
                onChange={(e) => set('shortcut', e.target.value)}
                className="font-mono"
              />
            </div>
          </Field>
          <Field
            label={t('title')}
            htmlFor={`${ids}-title`}
            error={
              shown('title')
                ? t(shown('title') === 'titleLong' ? 'titleLong' : 'titleEmpty', {
                    max: SAVED_REPLY_TITLE_MAX,
                  })
                : undefined
            }
          >
            <Input
              id={`${ids}-title`}
              value={draft.title}
              maxLength={SAVED_REPLY_TITLE_MAX + 20}
              invalid={Boolean(shown('title'))}
              placeholder={t('titlePlaceholder')}
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>
        </div>

        <Field
          label={t('body')}
          htmlFor={`${ids}-body`}
          hint={t('bodyHint')}
          error={
            shown('body')
              ? t(shown('body') === 'bodyLong' ? 'bodyLong' : 'bodyEmpty', {
                  max: SAVED_REPLY_BODY_MAX,
                })
              : undefined
          }
        >
          <Textarea
            id={`${ids}-body`}
            ref={body}
            rows={6}
            dir="auto"
            value={draft.body}
            invalid={Boolean(shown('body'))}
            placeholder={t('bodyPlaceholder')}
            onChange={(e) => set('body', e.target.value)}
          />
          <p
            className="text-end text-xs tabular-nums text-muted-foreground"
            data-testid="saved-reply-count"
          >
            {t('count', { n: draft.body.trim().length, max: SAVED_REPLY_BODY_MAX })}
          </p>
        </Field>

        <div>
          <p className="text-sm font-medium">{t('variables')}</p>
          <p className="text-xs text-muted-foreground">{t('variablesHint')}</p>
          <div className="mt-2 space-y-2">
            {SAVED_REPLY_VARIABLE_GROUPS.map((group) => (
              <div key={group} className="flex flex-wrap items-center gap-1.5">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{tg(group)}</span>
                {SAVED_REPLY_VARIABLES.filter((v) => v.group === group).map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    title={tv(v.key)}
                    aria-label={`${tv(v.key)} {{${v.key}}}`}
                    data-testid={`saved-reply-var-${v.key}`}
                    onClick={() => addVariable(v.key)}
                    className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-xs hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-primary"
                    dir="ltr"
                  >
                    {`{{${v.key}}}`}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        <section
          aria-label={t('preview')}
          data-testid="saved-reply-preview"
          className="rounded-lg border border-border bg-muted/40 p-3"
        >
          <p className="text-xs font-semibold text-muted-foreground">{t('preview')}</p>
          <p className="text-xs text-muted-foreground">{t('previewHint')}</p>
          {draft.body.trim() === '' ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('previewEmpty')}</p>
          ) : (
            <p dir="auto" className="mt-2 whitespace-pre-wrap break-words text-sm">
              {preview.text}
            </p>
          )}
          {preview.issues.length > 0 && (
            <p
              role="status"
              className="mt-2 text-xs text-warning"
              data-testid="saved-reply-preview-issues"
            >
              {t('previewIssues', { list: preview.issues.map((i) => i.token).join(', ') })}
            </p>
          )}
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('category')} htmlFor={`${ids}-category`}>
            <Input
              id={`${ids}-category`}
              value={draft.category}
              maxLength={SAVED_REPLY_CATEGORY_MAX}
              placeholder={t('categoryPlaceholder')}
              onChange={(e) => set('category', e.target.value)}
            />
          </Field>
          <Field
            label={t('language')}
            htmlFor={`${ids}-language`}
            hint={t('languageHint')}
            error={shown('language') ? t('languageFormat') : undefined}
          >
            <Input
              id={`${ids}-language`}
              value={draft.language}
              maxLength={16}
              dir="ltr"
              invalid={Boolean(shown('language'))}
              placeholder="en"
              onChange={(e) => set('language', e.target.value)}
            />
          </Field>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('channels')}</legend>
          <p className="text-xs text-muted-foreground">{t('channelsHint')}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {CHANNEL_KINDS.map((k) => (
              <Checkbox
                key={k}
                label={tk(k)}
                checked={draft.channelKinds.includes(k)}
                onChange={(e) =>
                  set(
                    'channelKinds',
                    e.target.checked
                      ? [...draft.channelKinds, k]
                      : draft.channelKinds.filter((x) => x !== k),
                  )
                }
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2" disabled={editing}>
          <legend className="text-sm font-medium">{t('scope')}</legend>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
            {(['shared', 'mine'] as const).map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${ids}-scope`}
                  checked={draft.scope === s}
                  onChange={() => set('scope', s)}
                />
                {t(`scopeOption.${s}`)}
              </label>
            ))}
          </div>
          {editing && <p className="text-xs text-muted-foreground">{t('scopeLocked')}</p>}
        </fieldset>
      </form>
    </Modal>
  );
}
