'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { otpSenderViewSchema, otpSenderDeleteResponseSchema } from '@crm/contracts';
import type { OtpSenderKind, OtpSenderView, OtpSendersResponse } from '@crm/contracts';
import { Alert, Badge, Button, Field, Input, Modal, PasswordInput, Select, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import {
  KIND_FIELDS,
  addableKinds,
  buildSenderCreate,
  buildSenderPatch,
  emptySenderDraft,
  senderFieldForPath,
  senderRef,
  senderSummary,
  senderToDraft,
  type SenderDraft,
  type SenderField,
  type SenderProblem,
  type SenderProblems,
} from '../lib/otp-senders';
import { operatorFetch } from '../operator-fetch';
import { useToast } from '../ui/toast';
import { OTP_SENDERS_KEY, REGISTRATION_KEY } from './query-keys';

const NS = 'auth-registration-security.platform.registration.senders';

type Mode = { type: 'list' } | { type: 'add' } | { type: 'edit'; id: string };
type Errors = Partial<Record<SenderField, string>>;
const MONO_FIELDS: ReadonlySet<SenderField> = new Set([
  'phoneNumberId',
  'wabaId',
  'graphBaseUrl',
  'accountSid',
  'fromNumber',
  'apiBaseUrl',
  'bridgeUrl',
  'senderNumber',
]);

/**
 * "Manage senders": the connections that can deliver the sign-up code. Add, edit and remove, with
 * write-only secrets (a saved one shows only as "saved"; leave it blank to keep it, or remove it).
 * Stands in for the channel screens until those areas exist.
 */
export function SendersModal({
  open,
  onClose,
  data,
  loading,
  canEdit,
  savedSender,
  onRemoved,
}: {
  open: boolean;
  onClose: () => void;
  data: OtpSendersResponse | undefined;
  loading: boolean;
  canEdit: boolean;
  /** The sender sign-up currently uses (saved), to warn before removing it. */
  savedSender: string | null;
  onRemoved: (ref: string) => void;
}) {
  const t = useTranslations(NS);
  const tp = useTranslations(`${NS}.problems`);
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>({ type: 'list' });
  const [draft, setDraft] = useState<SenderDraft>(() => emptySenderDraft('waba'));
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<{ detail?: string; requestId?: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmSecret, setConfirmSecret] = useState(false);

  const senders = data?.senders ?? [];
  const editing = mode.type === 'edit' ? senders.find((s) => s.id === mode.id) : undefined;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: OTP_SENDERS_KEY });
    // The saved registration reports whether sign-up can still use its sender.
    void qc.invalidateQueries({ queryKey: REGISTRATION_KEY });
  };

  const back = () => {
    setMode({ type: 'list' });
    setErrors({});
    setFailure(null);
    setConfirmSecret(false);
  };
  const close = () => {
    back();
    setConfirmRemove(null);
    onClose();
  };

  const problemText = (p: SenderProblem): string =>
    p.code === 'tooLong' ? tp('tooLong', { max: p.max }) : tp(p.code);

  function failWith(err: unknown) {
    if (err instanceof ApiError && err.status === 422) {
      const next: Errors = {};
      for (const fe of err.fieldErrors) {
        const f = senderFieldForPath(fe.path);
        if (f && !next[f]) next[f] = fe.message;
      }
      setErrors(next);
      setFailure(Object.keys(next).length === 0 ? { detail: err.message } : null);
    } else if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
      /* operatorFetch is sending the person to sign in */
    } else {
      setFailure({
        detail: err instanceof ApiError && err.status === 409 ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : undefined,
      });
    }
  }

  const create = useMutation({
    mutationFn: (body: NonNullable<ReturnType<typeof buildSenderCreate>['body']>) =>
      operatorFetch('/settings/senders', { method: 'POST', body, schema: otpSenderViewSchema }),
    onSuccess: () => {
      refresh();
      toast.success(t('added'));
      back();
    },
    onError: failWith,
  });

  const update = useMutation({
    mutationFn: (args: {
      id: string;
      patch: Record<string, unknown>;
      done: 'saved' | 'secretRemoved';
    }) =>
      operatorFetch(`/settings/senders/${args.id}`, {
        method: 'PATCH',
        body: args.patch,
        schema: otpSenderViewSchema,
      }),
    onSuccess: (_d, args) => {
      refresh();
      toast.success(t(args.done));
      if (args.done === 'saved') back();
      else setConfirmSecret(false);
    },
    onError: failWith,
  });

  const remove = useMutation({
    mutationFn: (s: OtpSenderView) =>
      operatorFetch(`/settings/senders/${s.id}`, {
        method: 'DELETE',
        schema: otpSenderDeleteResponseSchema,
      }),
    onSuccess: (_d, s) => {
      refresh();
      onRemoved(senderRef(s));
      toast.success(t('removed'));
      setConfirmRemove(null);
    },
    onError: (err) => {
      setConfirmRemove(null);
      failWith(err);
    },
  });

  const busy = create.isPending || update.isPending || remove.isPending;

  function startAdd() {
    setDraft(emptySenderDraft(addableKinds(data?.devAllowed ?? false)[0] ?? 'waba'));
    setErrors({});
    setFailure(null);
    setMode({ type: 'add' });
  }
  function startEdit(s: OtpSenderView) {
    setDraft(senderToDraft(s));
    setErrors({});
    setFailure(null);
    setConfirmSecret(false);
    setMode({ type: 'edit', id: s.id });
  }

  function submit() {
    if (busy) return;
    setFailure(null);
    if (mode.type === 'add') {
      const { body, problems } = buildSenderCreate(draft);
      if (!body) return showProblems(problems);
      setErrors({});
      create.mutate(body);
    } else if (mode.type === 'edit' && editing) {
      const { patch, problems } = buildSenderPatch(editing, draft);
      if (Object.keys(problems).length > 0) return showProblems(problems);
      setErrors({});
      if (Object.keys(patch).length === 0) return back();
      update.mutate({ id: editing.id, patch, done: 'saved' });
    }
  }
  function showProblems(problems: SenderProblems) {
    const next: Errors = {};
    for (const [field, p] of Object.entries(problems) as Array<[SenderField, SenderProblem]>) {
      next[field] = problemText(p);
    }
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      setTimeout(() => document.getElementById(`sender-${first}`)?.focus(), 0);
    }
  }

  const setField = (field: SenderField, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  };

  const kindName = (k: OtpSenderKind) => t(`kinds.${k}`);
  const formKind = mode.type === 'edit' ? (editing?.kind ?? draft.kind) : draft.kind;

  const fieldFor = (field: SenderField) => {
    const id = `sender-${field}`;
    const isSecret = field === 'secret';
    const hint = isSecret
      ? mode.type === 'edit' && editing?.hasSecret
        ? t('secretHintSaved')
        : t('secretHint')
      : t.has(`hints.${formKind}.${field}`)
        ? t(`hints.${formKind}.${field}`)
        : undefined;
    const label = isSecret ? t(`secretLabel.${formKind}`) : t(`fields.${field}`);
    return (
      <Field key={field} label={label} htmlFor={id} hint={hint} error={errors[field]}>
        {isSecret ? (
          <PasswordInput
            id={id}
            value={draft.secret}
            onChange={(e) => setField('secret', e.target.value)}
            placeholder={mode.type === 'edit' && editing?.hasSecret ? t('secretSaved') : undefined}
            invalid={Boolean(errors.secret)}
            autoComplete="new-password"
            showLabel={t('showSecret')}
            hideLabel={t('hideSecret')}
            dir="ltr"
            className="font-mono"
          />
        ) : (
          <Input
            id={id}
            value={draft[field]}
            onChange={(e) => setField(field, e.target.value)}
            placeholder={
              field === 'graphBaseUrl' || field === 'apiBaseUrl'
                ? t(`defaults.${field}`)
                : undefined
            }
            invalid={Boolean(errors[field])}
            autoComplete="off"
            spellCheck={false}
            dir={MONO_FIELDS.has(field) ? 'ltr' : undefined}
            className={MONO_FIELDS.has(field) ? 'font-mono' : undefined}
          />
        )}
        {isSecret && mode.type === 'edit' && editing?.hasSecret && (
          <div className="pt-1">
            {confirmSecret ? (
              <div className="space-y-2 rounded-md border border-border p-2 text-xs">
                <p>{t('removeSecretBody')}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() =>
                      update.mutate({
                        id: editing.id,
                        patch: { clearSecret: true },
                        done: 'secretRemoved',
                      })
                    }
                  >
                    {update.isPending && <Spinner label={t('working')} />}
                    {t('removeSecretConfirm')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setConfirmSecret(false)}>
                    {t('keep')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="text-danger hover:bg-danger/10"
                onClick={() => setConfirmSecret(true)}
                disabled={busy}
              >
                {t('removeSecret')}
              </Button>
            )}
          </div>
        )}
      </Field>
    );
  };

  const listView = (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {loading && !data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner label={t('working')} /> {t('loading')}
        </p>
      ) : senders.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul
          className="divide-y divide-border rounded-md border border-border"
          aria-label={t('title')}
        >
          {senders.map((s) => {
            const ref = senderRef(s);
            const confirming = confirmRemove === s.id;
            return (
              <li key={s.id} className="space-y-2 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-medium">{s.label}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge>{kindName(s.kind)}</Badge>
                      {senderSummary(s) && (
                        <span dir="ltr" className="font-mono">
                          {senderSummary(s)}
                        </span>
                      )}
                    </p>
                    <p className="flex flex-wrap gap-1.5">
                      {s.kind !== 'dev' &&
                        (s.hasSecret ? (
                          <Badge tone="success">{t('hasSecret')}</Badge>
                        ) : (
                          <Badge tone="warning">{t('noSecret')}</Badge>
                        ))}
                      {savedSender === ref && <Badge tone="success">{t('inUse')}</Badge>}
                    </p>
                  </div>
                  {canEdit && !confirming && (
                    <span className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => startEdit(s)}
                        disabled={busy}
                      >
                        {t('edit')}
                        <span className="sr-only"> {s.label}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger hover:bg-danger/10"
                        onClick={() => setConfirmRemove(s.id)}
                        disabled={busy}
                      >
                        {t('remove')}
                        <span className="sr-only"> {s.label}</span>
                      </Button>
                    </span>
                  )}
                </div>
                {confirming && (
                  <div className="space-y-2 rounded-md border border-border bg-muted p-3 text-sm">
                    <p>
                      {savedSender === ref
                        ? t('removeBodyInUse', { label: s.label })
                        : t('removeBody', { label: s.label })}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={() => remove.mutate(s)}
                      >
                        {remove.isPending && <Spinner label={t('working')} />}
                        {t('removeConfirm')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirmRemove(null)}>
                        {t('keep')}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  // Not a <form>: the dialog is portalled out of the page's own form, and a submit event would
  // still bubble through React to it. Enter in a text field saves the sender instead.
  const formView = (
    <div
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          submit();
        }
      }}
      className="space-y-4"
    >
      <h3 className="text-sm font-semibold">
        {mode.type === 'add' ? t('addTitle') : t('editTitle', { label: editing?.label ?? '' })}
      </h3>
      {mode.type === 'add' ? (
        <Field label={t('kind')} htmlFor="sender-kind" hint={t(`kindHint.${draft.kind}`)}>
          <Select
            id="sender-kind"
            value={draft.kind}
            onChange={(e) => {
              setDraft((d) => ({
                ...emptySenderDraft(e.target.value as OtpSenderKind),
                label: d.label,
              }));
              setErrors({});
            }}
          >
            {addableKinds(data?.devAllowed ?? false).map((k) => (
              <option key={k} value={k}>
                {kindName(k)}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <p className="text-xs text-muted-foreground">
          <Badge>{kindName(formKind)}</Badge>
        </p>
      )}
      {KIND_FIELDS[formKind].map(fieldFor)}
      {failure && (
        <Alert tone="danger" className="space-y-1">
          <p>{failure.detail ?? t('errors.unexpected')}</p>
          {failure.requestId && (
            <p className="text-xs opacity-80">
              {t('requestId')}: <span className="font-mono">{failure.requestId}</span>
            </p>
          )}
        </Alert>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('title')}
      className="w-[min(42rem,calc(100vw-2rem))]"
      footer={
        mode.type === 'list' ? (
          <>
            {canEdit && (
              <Button variant="secondary" onClick={startAdd} disabled={busy}>
                {t('add')}
              </Button>
            )}
            <Button onClick={close}>{t('close')}</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={back} disabled={busy}>
              {t('cancel')}
            </Button>
            <Button onClick={submit} disabled={busy}>
              {(create.isPending || update.isPending) && <Spinner label={t('working')} />}
              {t('save')}
            </Button>
          </>
        )
      }
    >
      <div className="max-h-[65vh] space-y-3 overflow-y-auto pe-1">
        {mode.type === 'list' && failure && (
          <Alert tone="danger" className="space-y-1">
            <p>{failure.detail ?? t('errors.unexpected')}</p>
            {failure.requestId && (
              <p className="text-xs opacity-80">
                {t('requestId')}: <span className="font-mono">{failure.requestId}</span>
              </p>
            )}
          </Alert>
        )}
        {mode.type === 'list' ? listView : formView}
      </div>
    </Modal>
  );
}
