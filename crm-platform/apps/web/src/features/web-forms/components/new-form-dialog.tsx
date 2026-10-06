'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { PLAN_UPGRADE_PATH } from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, Spinner, cn } from '@crm/ui';
import { createForm, KEYS, useFormTemplates } from '../api/forms';
import { errorKind } from '../lib/errors';
import { MAX_NAME } from '../lib/list-model';
import { fieldsOf } from '../lib/builder-model';

export type StartMode = 'template' | 'blank';

/**
 * "New form": start from a template of the gallery or from a blank form. Creating makes a DRAFT (nothing is public until Publish) and
 * opens it in the builder. The plan's forms limit is the API's rule; its answer is shown here with a way to upgrade.
 */
export function NewFormDialog(props: {
  open: boolean;
  onClose: () => void;
  mode: StartMode;
  onMode: (m: StartMode) => void;
  templateKey: string | null;
  onTemplate: (key: string | null) => void;
}) {
  // Mounted only while open, so every opening starts clean (empty name, no error) without effects that reset state.
  return props.open ? <NewFormBody {...props} /> : null;
}

function NewFormBody({
  onClose,
  mode,
  onMode,
  templateKey,
  onTemplate,
}: {
  open: boolean;
  onClose: () => void;
  mode: StartMode;
  onMode: (m: StartMode) => void;
  templateKey: string | null;
  onTemplate: (key: string | null) => void;
}) {
  const t = useTranslations('web-forms.newForm');
  const e = useTranslations('web-forms.errors');
  const router = useRouter();
  const qc = useQueryClient();
  const nameId = useId();
  const templates = useFormTemplates();
  const [typed, setTyped] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ReturnType<typeof errorKind> | null>(null);

  const chosen = templates.data?.find((x) => x.key === templateKey) ?? null;
  // A name nobody typed follows the chosen template; one the person typed is never overwritten.
  const name = typed ?? (mode === 'template' && chosen ? chosen.name : '');

  const trimmed = name.trim();
  const missingName = trimmed === '';
  const needTemplate = mode === 'template' && !chosen;

  const create = async () => {
    setTouched(true);
    if (missingName || needTemplate) return;
    setBusy(true);
    setFailure(null);
    try {
      const form = await createForm({
        name: trimmed,
        ...(mode === 'template' && chosen ? { templateKey: chosen.key } : {}),
      });
      void qc.invalidateQueries({ queryKey: KEYS.all });
      router.push(`/forms/${form.id}`);
    } catch (err) {
      setFailure(errorKind(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={t('eyebrow')}
      title={t('title')}
      closeLabel={t('close')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void create()} disabled={busy}>
            {busy && <Spinner />}
            {t('create')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div
          role="group"
          aria-label={t('startFrom')}
          className="inline-flex rounded-md border border-border p-0.5"
        >
          {(['template', 'blank'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => onMode(m)}
              className={cn(
                'h-9 rounded px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                mode === m
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t(`mode.${m}`)}
            </button>
          ))}
        </div>

        {mode === 'template' && (
          <div>
            {templates.isPending && (
              <div className="flex justify-center py-8">
                <Spinner label={t('loadingTemplates')} />
              </div>
            )}
            {templates.isError && <Alert tone="danger">{t('templatesFailed')}</Alert>}
            {templates.data && (
              <ul
                role="radiogroup"
                aria-label={t('templates')}
                className="grid gap-2 sm:grid-cols-2"
              >
                {templates.data.map((tpl) => {
                  const active = tpl.key === templateKey;
                  return (
                    <li key={tpl.key}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => onTemplate(tpl.key)}
                        className={cn(
                          'h-full w-full rounded-md border p-3 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                          active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted',
                        )}
                      >
                        <span className="block text-sm font-semibold">{tpl.name}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {tpl.description}
                        </span>
                        <span className="mt-2 block text-xs text-muted-foreground">
                          {t('fieldCount', { count: fieldsOf(tpl.definition).length })}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {touched && needTemplate && (
              <p role="alert" className="mt-2 text-xs text-danger">
                {t('pickTemplate')}
              </p>
            )}
          </div>
        )}

        <Field
          label={t('name')}
          htmlFor={nameId}
          hint={t('nameHint')}
          error={
            failure === 'nameTaken'
              ? e('nameTaken')
              : touched && missingName
                ? t('nameRequired')
                : undefined
          }
        >
          <Input
            id={nameId}
            value={name}
            maxLength={MAX_NAME}
            invalid={failure === 'nameTaken' || (touched && missingName)}
            onChange={(ev) => {
              setTouched(true);
              setTyped(ev.target.value);
              if (failure === 'nameTaken') setFailure(null);
            }}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') void create();
            }}
          />
        </Field>

        {failure === 'planLimit' && (
          <Alert tone="warning">
            {e('planLimitForms')}{' '}
            <Link href={PLAN_UPGRADE_PATH} className="font-medium underline">
              {e('upgrade')}
            </Link>
          </Alert>
        )}
        {failure && failure !== 'nameTaken' && failure !== 'planLimit' && (
          <Alert tone="danger">{e(failure)}</Alert>
        )}
      </div>
    </Modal>
  );
}
