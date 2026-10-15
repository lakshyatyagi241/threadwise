'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import type { EmailTemplate } from '@crm/contracts';
import { Button, Field, Input, Modal, Spinner, useToast } from '@crm/ui';
import { RichEditor, type RichEditorHandle } from '@/features/channel-email/components/rich-editor';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { invalidateTemplates, templatesApi } from '../api/templates';
import { errorKind } from '../lib/errors';
import {
  EMPTY_FORM,
  LIMITS,
  fromTemplate,
  toCreateInput,
  toUpdateInput,
  validate,
  type FormErrorKind,
  type FormField,
  type TemplateFormValues,
} from '../lib/form';
import { TemplatePreview } from './template-preview';
import { VariablePicker } from './variable-picker';

export interface TemplateEditorModalProps {
  /** Present: edit this template. Absent: create. */
  template?: EmailTemplate;
  /** The categories already in use, offered as suggestions. */
  categories: readonly string[];
  onClose: () => void;
  onSaved?: (template: EmailTemplate) => void;
}

type ErrorKey = FormField | 'form';

/**
 * "New email template" and "Edit email template". Name, subject, the formatted message with a variable picker, category, the type
 * (general or marketing) and, when creating, who can use it. A live preview shows the result with sample data. Mount it only while it
 * is open: it starts from the template every time.
 */
export function TemplateEditorModal({
  template,
  categories,
  onClose,
  onSaved,
}: TemplateEditorModalProps) {
  const t = useTranslations('emailTemplates.editor');
  const tToast = useTranslations('emailTemplates.toast');
  const tErr = useTranslations('emailTemplates.errors');
  const { toast } = useToast();
  const qc = useQueryClient();
  const canManage = useCan('mail.templates.manage');
  const editing = template !== undefined;
  const [values, setValues] = useState<TemplateFormValues>(() =>
    template ? fromTemplate(template) : { ...EMPTY_FORM, scope: canManage ? 'shared' : 'mine' },
  );
  const [errors, setErrors] = useState<Partial<Record<ErrorKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<'subject' | 'body'>('body');
  const subject = useRef<HTMLInputElement>(null);
  const editor = useRef<RichEditorHandle>(null);
  const set = <K extends keyof TemplateFormValues>(k: K, v: TemplateFormValues[K]) =>
    setValues((s) => ({ ...s, [k]: v }));

  const problem = (kind: FormErrorKind | undefined, limit: number) =>
    kind ? t(`problems.${kind}`, { limit }) : undefined;

  function insertVariable(token: string) {
    if (target === 'subject' && subject.current) {
      const el = subject.current;
      const at = el.selectionStart ?? values.subject.length;
      const end = el.selectionEnd ?? at;
      const next = values.subject.slice(0, at) + token + values.subject.slice(end);
      set('subject', next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(at + token.length, at + token.length);
      });
      return;
    }
    editor.current?.insertText(token);
  }

  async function submit() {
    const found = validate(values);
    if (Object.keys(found).length > 0) {
      setErrors({
        name: problem(found.name, LIMITS.name),
        subject: problem(found.subject, LIMITS.subject),
        html: problem(found.html, LIMITS.html),
        category: problem(found.category, LIMITS.category),
      });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      let saved: EmailTemplate;
      if (template) {
        const patch = toUpdateInput(values, template);
        if (patch === null) {
          onClose();
          return;
        }
        saved = await templatesApi.update(template.id, patch);
      } else {
        saved = await templatesApi.create(toCreateInput(values));
      }
      await invalidateTemplates(qc);
      toast(tToast(editing ? 'updated' : 'created'), 'success');
      onSaved?.(saved);
      onClose();
    } catch (e) {
      const kind = errorKind(e);
      if (kind === 'conflict') void invalidateTemplates(qc);
      setErrors(kind === 'nameTaken' ? { name: tErr('nameTaken') } : { form: tErr(kind) });
    } finally {
      setBusy(false);
    }
  }

  const listId = 'email-template-categories';
  return (
    <Modal
      open
      size="lg"
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={t('eyebrow')}
      title={editing ? t('editTitle') : t('newTitle')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            variant="brand"
            data-testid="email-template-save"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy && <Spinner />}
            {editing ? t('save') : t('create')}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        data-testid="email-template-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        {errors.form && (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {errors.form}
          </p>
        )}
        <Field
          label={t('name')}
          htmlFor="email-template-name"
          error={errors.name}
          className="sm:col-span-2"
        >
          <Input
            id="email-template-name"
            data-testid="email-template-name"
            autoFocus
            required
            dir="auto"
            maxLength={LIMITS.name}
            value={values.name}
            invalid={!!errors.name}
            placeholder={t('namePlaceholder')}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>
        <Field
          label={t('subject')}
          htmlFor="email-template-subject"
          error={errors.subject}
          hint={t('subjectHint')}
          className="sm:col-span-2"
        >
          <Input
            id="email-template-subject"
            data-testid="email-template-subject"
            ref={subject}
            dir="auto"
            maxLength={LIMITS.subject}
            value={values.subject}
            invalid={!!errors.subject}
            placeholder={t('subjectPlaceholder', {
              workspace: '{{workspace_name}}',
              name: '{{first_name}}',
            })}
            onFocus={() => setTarget('subject')}
            onChange={(e) => set('subject', e.target.value)}
          />
        </Field>
        <div className="space-y-1.5 text-sm sm:col-span-2">
          <span className="block font-medium">{t('body')}</span>
          <div onFocusCapture={() => setTarget('body')}>
            <RichEditor
              handleRef={editor}
              initialHtml={values.html}
              resetKey={template?.id ?? 'new'}
              onChange={(html) => set('html', html)}
              label={t('body')}
              placeholder={t('bodyPlaceholder')}
              testId="email-template-editor"
              className="min-h-40"
            />
          </div>
          {errors.html && (
            <p role="alert" className="text-xs text-danger">
              {errors.html}
            </p>
          )}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-medium">{t('variables')}</span>
            <span className="text-xs text-muted-foreground">
              {t('insertingIn', { field: t(`fields.${target}`) })}
            </span>
          </div>
          <VariablePicker onInsert={insertVariable} disabled={busy} />
          <p className="text-xs text-muted-foreground">{t('variablesHint')}</p>
        </div>
        <Field label={t('category')} htmlFor="email-template-category" error={errors.category}>
          <Input
            id="email-template-category"
            data-testid="email-template-category"
            dir="auto"
            list={listId}
            maxLength={LIMITS.category}
            value={values.category}
            invalid={!!errors.category}
            placeholder={t('categoryPlaceholder')}
            onChange={(e) => set('category', e.target.value)}
          />
          <datalist id={listId} aria-label={t('categoryList')}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <fieldset className="space-y-1.5 text-sm">
          <legend className="mb-1.5 font-medium">{t('purpose')}</legend>
          {(['general', 'marketing'] as const).map((p) => (
            <label key={p} className="flex items-start gap-2">
              <input
                type="radio"
                name="email-template-purpose"
                data-testid={`email-template-purpose-${p}`}
                className="mt-1"
                checked={values.purpose === p}
                onChange={() => set('purpose', p)}
              />
              <span>
                <span className="block">{t(`purposes.${p}.label`)}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(`purposes.${p}.hint`)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {!editing && (
          <fieldset className="space-y-1.5 text-sm sm:col-span-2">
            <legend className="mb-1.5 font-medium">{t('scope')}</legend>
            {(['shared', 'mine'] as const).map((s) => (
              <label key={s} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="email-template-scope"
                  data-testid={`email-template-scope-${s}`}
                  className="mt-1"
                  checked={values.scope === s}
                  disabled={s === 'shared' && !canManage}
                  onChange={() => set('scope', s)}
                />
                <span>
                  <span className="block">{t(`scopes.${s}.label`)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`scopes.${s}.hint`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="sm:col-span-2">
          <TemplatePreview subject={values.subject} html={values.html} />
        </div>
      </form>
    </Modal>
  );
}
