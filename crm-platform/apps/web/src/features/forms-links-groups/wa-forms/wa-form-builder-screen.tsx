'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type {
  SaveWaFormInput,
  WaForm,
  WaFormAudienceType,
  WaFormDefinition,
  WaFormField,
  WaFormFieldKind,
} from '@crm/contracts';
import { WA_FORM_AUDIENCE_TYPES, WA_FORM_CHOICE_FIELD_KINDS, WA_FORM_FIELD_KINDS } from '@crm/contracts';
import { Alert, Button, Card, Checkbox, Field, Input, Select, Spinner, Textarea } from '@crm/ui';
import { useSaveWaForm, usePublishWaForm, useWaForm } from '../api/wa-forms-hooks';
import { useErrorText } from '../components/use-error-text';

function randomFieldId(): string {
  return `fld_${Math.random().toString(36).slice(2, 8)}`;
}

function randomScreenId(): string {
  return `scr_${Math.random().toString(36).slice(2, 8)}`;
}

/** `/wa-forms/[id]` (Reference form builder): basics + a screen/field editor. Editing a published form drops it to draft — server-enforced. */
export function WaFormBuilderScreen({ id }: { id: string }) {
  const t = useTranslations('forms-links-groups.forms');
  const errorText = useErrorText();
  const form = useWaForm(id);

  if (form.isPending) {
    return (
      <div className="mx-auto max-w-5xl p-6 text-sm text-muted-foreground">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (form.isError) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <Alert tone="danger">{errorText(form.error).text}</Alert>
      </div>
    );
  }

  // Keyed by (id, rowVersion): a fresh mount re-seeds local state from the server record without ever calling
  // setState from inside an effect. Local edits survive background refetches of the same version.
  return <WaFormBuilderForm key={`${form.data.id}:${form.data.rowVersion}`} id={id} initial={form.data} />;
}

function WaFormBuilderForm({ id, initial }: { id: string; initial: WaForm }) {
  const t = useTranslations('forms-links-groups.forms');
  const errorText = useErrorText();
  const save = useSaveWaForm(id);
  const publish = usePublishWaForm(id);

  const [title, setTitle] = useState(initial.title);
  const [purpose, setPurpose] = useState(initial.purpose ?? '');
  const [audienceType, setAudienceType] = useState<WaFormAudienceType>(initial.audienceType);
  const [sendButtonLabel, setSendButtonLabel] = useState(initial.sendButtonLabel);
  const [thankYouNote, setThankYouNote] = useState(initial.thankYouNote ?? '');
  const [definition, setDefinition] = useState<WaFormDefinition>(initial.definition);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const input = (): SaveWaFormInput => ({
    title,
    purpose: purpose || undefined,
    audienceType,
    submissionCap: initial.submissionCap,
    capReachedNote: initial.capReachedNote ?? undefined,
    sendButtonLabel,
    thankYouNote: thankYouNote || undefined,
    definition,
    rowVersion: initial.rowVersion,
  });

  // Save/publish update the query cache (see the hooks); the parent remounts this component on the new
  // (id, rowVersion) key, which is how the fresh server state (including the drop-to-draft on edit) shows up.
  const onSave = () =>
    save.mutate(input(), {
      onSuccess: () => setNotice({ tone: 'success', text: t('notice.saved') }),
      onError: (err) => setNotice({ tone: 'danger', text: errorText(err).text }),
    });

  const onPublish = () =>
    save.mutate(input(), {
      onSuccess: () =>
        publish.mutate(undefined, {
          onSuccess: () => setNotice({ tone: 'success', text: t('notice.published') }),
          onError: (err) => setNotice({ tone: 'danger', text: errorText(err).text }),
        }),
      onError: (err) => setNotice({ tone: 'danger', text: errorText(err).text }),
    });

  const addScreen = () =>
    setDefinition((d) => ({
      // A unique id, not one derived from the current count: removing a screen and adding a new one would
      // otherwise mint an id that collides with a screen still in the list (both the React key and the
      // persisted definition_json would then have two screens sharing one id).
      screens: [...d.screens, { id: randomScreenId(), fields: [] }],
    }));

  const removeScreen = (screenIndex: number) =>
    setDefinition((d) => ({ screens: d.screens.filter((_, i) => i !== screenIndex) }));

  const addField = (screenIndex: number, kind: WaFormFieldKind) =>
    setDefinition((d) => ({
      screens: d.screens.map((s, i) =>
        i === screenIndex
          ? { ...s, fields: [...s.fields, { id: randomFieldId(), kind, label: t('builder.newFieldLabel'), required: false }] }
          : s,
      ),
    }));

  const updateField = (screenIndex: number, fieldIndex: number, patch: Partial<WaFormField>) =>
    setDefinition((d) => ({
      screens: d.screens.map((s, i) =>
        i === screenIndex
          ? { ...s, fields: s.fields.map((f, j) => (j === fieldIndex ? { ...f, ...patch } : f)) }
          : s,
      ),
    }));

  const removeField = (screenIndex: number, fieldIndex: number) =>
    setDefinition((d) => ({
      screens: d.screens.map((s, i) =>
        i === screenIndex ? { ...s, fields: s.fields.filter((_, j) => j !== fieldIndex) } : s,
      ),
    }));

  const moveField = (screenIndex: number, fieldIndex: number, dir: -1 | 1) =>
    setDefinition((d) => ({
      screens: d.screens.map((s, i) => {
        if (i !== screenIndex) return s;
        const fields = [...s.fields];
        const j = fieldIndex + dir;
        if (j < 0 || j >= fields.length) return s;
        [fields[fieldIndex], fields[j]] = [fields[j], fields[fieldIndex]];
        return { ...s, fields };
      }),
    }));

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <a href="/wa-forms" className="text-sm text-muted-foreground hover:underline">
            {t('builder.back')}
          </a>
          <h1 className="mt-1 text-2xl font-semibold">{title || t('builder.untitled')}</h1>
          <span
            className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs ${
              initial.status === 'published'
                ? 'bg-success/10 text-success'
                : initial.status === 'paused'
                  ? 'bg-warning/10 text-warning'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            {t(`status.${initial.status}`)}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={save.isPending} onClick={onSave}>
            {save.isPending ? t('builder.saving') : t('builder.saveDraft')}
          </Button>
          <Button disabled={save.isPending || publish.isPending} onClick={onPublish}>
            {publish.isPending ? t('builder.publishing') : t('builder.savePublish')}
          </Button>
        </div>
      </header>

      {notice && (
        <Alert tone={notice.tone} className="mt-4">
          {notice.text}
        </Alert>
      )}

      <Card className="mt-5 space-y-4 p-5">
        <h2 className="text-sm font-semibold">{t('builder.basics')}</h2>
        <Field label={t('builder.title')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
        </Field>
        <Field label={t('builder.audienceType')}>
          <Select value={audienceType} onChange={(e) => setAudienceType(e.target.value as WaFormAudienceType)}>
            {WA_FORM_AUDIENCE_TYPES.map((a) => (
              <option key={a} value={a}>
                {t(`audience.${a}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('builder.purpose')}>
          <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={2000} rows={2} />
        </Field>
        <Field label={t('builder.sendButtonLabel')}>
          <Input value={sendButtonLabel} onChange={(e) => setSendButtonLabel(e.target.value)} maxLength={40} />
        </Field>
        <Field label={t('builder.thankYouNote')}>
          <Textarea value={thankYouNote} onChange={(e) => setThankYouNote(e.target.value)} maxLength={500} rows={2} />
        </Field>
      </Card>

      <Card className="mt-5 space-y-5 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('builder.screens')}</h2>
          <Button variant="secondary" size="sm" onClick={addScreen}>
            {t('builder.addScreen')}
          </Button>
        </div>

        {definition.screens.map((screen, screenIndex) => (
          <div key={screen.id} className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">{t('builder.screenN', { n: screenIndex + 1 })}</h3>
              {definition.screens.length > 1 && (
                <button type="button" className="text-xs text-danger hover:underline" onClick={() => removeScreen(screenIndex)}>
                  {t('builder.removeScreen')}
                </button>
              )}
            </div>

            <div className="mt-3 space-y-3">
              {screen.fields.map((field, fieldIndex) => (
                <div key={field.id} className="rounded border border-border p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label={t('builder.fieldKind')} className="w-40">
                      <Select
                        value={field.kind}
                        onChange={(e) => updateField(screenIndex, fieldIndex, { kind: e.target.value as WaFormFieldKind })}
                      >
                        {WA_FORM_FIELD_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {t(`fieldKind.${k}`)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t('builder.fieldLabel')} className="min-w-[200px] flex-1">
                      <Input
                        value={field.label}
                        onChange={(e) => updateField(screenIndex, fieldIndex, { label: e.target.value })}
                        maxLength={300}
                      />
                    </Field>
                    {field.kind !== 'heading' && (
                      <Checkbox
                        checked={field.required}
                        onChange={(e) => updateField(screenIndex, fieldIndex, { required: e.target.checked })}
                        label={t('builder.required')}
                      />
                    )}
                    <div className="flex gap-1">
                      <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => moveField(screenIndex, fieldIndex, -1)}>
                        ↑
                      </button>
                      <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => moveField(screenIndex, fieldIndex, 1)}>
                        ↓
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs text-danger"
                        onClick={() => removeField(screenIndex, fieldIndex)}
                      >
                        {t('builder.removeField')}
                      </button>
                    </div>
                  </div>
                  {WA_FORM_CHOICE_FIELD_KINDS.includes(field.kind) && (
                    <Field label={t('builder.options')} className="mt-2">
                      <Input
                        value={(field.options ?? []).join(', ')}
                        onChange={(e) =>
                          updateField(screenIndex, fieldIndex, {
                            options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean),
                          })
                        }
                        placeholder={t('builder.optionsPlaceholder')}
                      />
                    </Field>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {WA_FORM_FIELD_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                  onClick={() => addField(screenIndex, kind)}
                >
                  + {t(`fieldKind.${kind}`)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
