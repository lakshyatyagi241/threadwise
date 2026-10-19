'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
  APPOINTMENT_MESSAGE_KINDS,
  type AppointmentMessageKind,
  type AppointmentTemplate,
  type AppointmentTemplateChannel,
  type PredefinedAppointmentTemplate,
} from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Input,
  Select,
  Spinner,
  Textarea,
  cn,
  useToast,
} from '@crm/ui';
import { KEYS, useMessageLibrary, usePredefinedMessages } from '../api/hooks';
import { channelsApi } from '../api/channels-service';
import { errorKind } from '../lib/errors';
import { ErrorLine, useAppointmentsCan } from './parts';
import { SettingsCard } from './settings-parts';

const STATUS_TONE = {
  draft: 'neutral',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
} as const;

/**
 * The library of appointment messages (BL-351), on the Appointment settings page: the predefined confirmation, reminder, reschedule,
 * cancellation and after-visit follow-up for email and WhatsApp, adopted with one click and edited. An email message lives in the app; a
 * WhatsApp message is a WhatsApp template that is sent to Meta for approval, and only an approved one can be chosen by a booking type.
 * Nothing here is sent to Meta until the owner presses the button.
 */
export function MessageLibrarySection() {
  const t = useTranslations('appointments.templates');
  const can = useAppointmentsCan();
  const library = useMessageLibrary();
  const predefined = usePredefinedMessages();

  return (
    <SettingsCard id="templates" title={t('title')} description={t('description')}>
      {library.isPending || predefined.isPending ? (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : library.isError || predefined.isError || !library.data || !predefined.data ? (
        <ErrorLine
          error={library.error ?? predefined.error}
          onRetry={() => {
            void library.refetch();
            void predefined.refetch();
          }}
        />
      ) : (
        <>
          <YourMessages items={library.data} canEdit={can.manageTemplates} />
          <PredefinedList
            entries={predefined.data.data}
            library={library.data}
            canEdit={can.manageTemplates}
          />
          {can.manageTemplates && <NewEmailMessage />}
          {!can.manageTemplates && <p className="text-xs text-muted-foreground">{t('readOnly')}</p>}
        </>
      )}
    </SettingsCard>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: KEYS.library });
    void qc.invalidateQueries({ queryKey: KEYS.waTemplates });
  };
}

// --- the workspace's messages -------------------------------------------------------------------------------------------------

function YourMessages({ items, canEdit }: { items: AppointmentTemplate[]; canEdit: boolean }) {
  const t = useTranslations('appointments.templates');
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
        {t('empty')}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{t('yours')}</h3>
      <ul className="space-y-2">
        {items.map((m) => (
          <li key={m.id}>
            <MessageRow message={m} canEdit={canEdit} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MessageRow({ message: m, canEdit }: { message: AppointmentTemplate; canEdit: boolean }) {
  const t = useTranslations('appointments.templates');
  const { toast } = useToast();
  const refresh = useRefresh();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | 'submit' | 'refresh' | 'delete'>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const whatsapp = m.channel === 'whatsapp';

  async function run<T>(kind: 'submit' | 'refresh' | 'delete', fn: () => Promise<T>): Promise<T | undefined> {
    if (busy) return undefined;
    setBusy(kind);
    setError(null);
    try {
      const out = await fn();
      refresh();
      return out;
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{m.name}</span>
            <Badge tone={STATUS_TONE[m.status]}>{t(`status.${m.status}`)}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(`kinds.${m.kind}`)} · {t(`channels.${m.channel}`)} · {m.language}
            {m.usedByTypes > 0 ? ` · ${t('usedBy', { count: m.usedByTypes })}` : ''}
            {!m.isActive ? ` · ${t('inactive')}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {whatsapp && canEdit && (m.status === 'draft' || m.status === 'rejected') && (
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={async () => {
                const r = await run('submit', () => channelsApi.submit(m.id));
                if (r) toast(r.metaError ? t('metaRefused') : t('submitted'), r.metaError ? 'danger' : 'success');
              }}
            >
              {busy === 'submit' ? t('submitting') : t('submit')}
            </Button>
          )}
          {whatsapp && canEdit && m.status === 'pending' && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={async () => {
                const r = await run('refresh', () => channelsApi.refresh(m.id));
                if (r) toast(t('refreshed'));
              }}
            >
              {busy === 'refresh' ? t('refreshing') : t('refresh')}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? t('close') : canEdit ? t('edit') : t('view')}
          </Button>
          {canEdit && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => setConfirmDelete(true)}
            >
              {t('delete')}
            </Button>
          )}
        </div>
      </div>
      {m.status === 'rejected' && m.rejectionReason && (
        <p role="alert" className="border-t border-border px-3 py-2 text-xs text-danger">
          {t('rejectedBecause', { reason: m.rejectionReason })}
        </p>
      )}
      {whatsapp && m.status === 'pending' && (
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {t('pendingNote')}
        </p>
      )}
      {error !== null && <ErrorLine error={error} className="m-3" />}
      {open && <EditForm message={m} canEdit={canEdit} onDone={() => setOpen(false)} />}
      <ConfirmDialog
        open={confirmDelete}
        title={t('deleteTitle', { name: m.name })}
        message={whatsapp ? t('deleteWhatsapp') : t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={busy === 'delete'}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          const done = await run('delete', async () => {
            await channelsApi.remove(m.id);
            return true;
          });
          if (done) toast(t('deleted'));
        }}
      />
    </div>
  );
}

function EditForm({
  message: m,
  canEdit,
  onDone,
}: {
  message: AppointmentTemplate;
  canEdit: boolean;
  onDone: () => void;
}) {
  const t = useTranslations('appointments.templates');
  const { toast } = useToast();
  const refresh = useRefresh();
  const whatsapp = m.channel === 'whatsapp';
  const textLocked = whatsapp && m.status !== 'draft' && m.status !== 'rejected';
  const [name, setName] = useState(m.name);
  const [subject, setSubject] = useState(m.subject ?? '');
  const [body, setBody] = useState(m.body);
  const [active, setActive] = useState(m.isActive);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const { data } = usePredefinedMessages();
  const dirty = name !== m.name || subject !== (m.subject ?? '') || body !== m.body || active !== m.isActive;

  async function save(submit: boolean) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await channelsApi.update(m.id, {
        name: name.trim() === m.name ? undefined : name.trim(),
        subject: whatsapp ? undefined : subject.trim(),
        body: body === m.body ? undefined : body,
        isActive: active === m.isActive ? undefined : active,
        submit,
        rowVersion: m.rowVersion,
      });
      refresh();
      toast(r.metaError ? t('metaRefused') : submit ? t('submitted') : t('saved'), r.metaError ? 'danger' : 'success');
      onDone();
    } catch (e) {
      setError(e);
      if (errorKind(e) === 'conflict') refresh();
    } finally {
      setSaving(false);
    }
  }

  const placeholders = whatsapp ? data?.whatsappPlaceholders : data?.placeholders;
  return (
    <div className="space-y-3 border-t border-border p-3">
      <label className="block space-y-1">
        <span className="text-xs font-medium">{t('nameLabel')}</span>
        <Input value={name} maxLength={120} disabled={!canEdit || saving} onChange={(e) => setName(e.target.value)} />
      </label>
      {!whatsapp && (
        <label className="block space-y-1">
          <span className="text-xs font-medium">{t('subjectLabel')}</span>
          <Input value={subject} maxLength={191} disabled={!canEdit || saving} onChange={(e) => setSubject(e.target.value)} />
        </label>
      )}
      <label className="block space-y-1">
        <span className="text-xs font-medium">{t('bodyLabel')}</span>
        <Textarea
          rows={whatsapp ? 4 : 7}
          value={body}
          maxLength={whatsapp ? 1024 : 4000}
          disabled={!canEdit || saving || textLocked}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      {textLocked && <p className="text-xs text-muted-foreground">{t('textLocked')}</p>}
      {placeholders && (
        <p className="text-xs text-muted-foreground">
          {whatsapp ? t('whatsappPlaceholders') : t('placeholders')}{' '}
          <span dir="ltr" className="font-mono">
            {placeholders.map((p) => `{{${p}}}`).join(' ')}
          </span>
        </p>
      )}
      {!whatsapp && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            disabled={!canEdit || saving}
            onChange={(e) => setActive(e.target.checked)}
          />
          {t('activeLabel')}
        </label>
      )}
      {error !== null && <ErrorLine error={error} />}
      {canEdit && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" disabled={saving} onClick={onDone}>
            {t('cancel')}
          </Button>
          <Button size="sm" disabled={saving || !dirty} onClick={() => void save(false)}>
            {saving ? t('saving') : t('save')}
          </Button>
          {whatsapp && !textLocked && (
            <Button size="sm" variant="secondary" disabled={saving} onClick={() => void save(true)}>
              {t('saveAndSubmit')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// --- the built-in set ----------------------------------------------------------------------------------------------------------

function PredefinedList({
  entries,
  library,
  canEdit,
}: {
  entries: PredefinedAppointmentTemplate[];
  library: AppointmentTemplate[];
  canEdit: boolean;
}) {
  const t = useTranslations('appointments.templates');
  const byKind = useMemo(
    () =>
      APPOINTMENT_MESSAGE_KINDS.map((kind) => ({
        kind,
        items: entries.filter((e) => e.kind === kind),
      })),
    [entries],
  );
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{t('predefinedTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('predefinedHint')}</p>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {byKind.map(({ kind, items }) => (
          <li key={kind} className="space-y-2 p-3">
            <div className="text-sm font-medium">{t(`kinds.${kind}`)}</div>
            <ul className="space-y-1.5">
              {items.map((p) => (
                <li key={`${p.key}-${p.channel}`}>
                  <PredefinedRow
                    entry={p}
                    adopted={library.find((l) => l.id === p.adoptedId)}
                    canEdit={canEdit}
                  />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <Alert tone="info" className="text-xs">
        {t('machineNote')}
      </Alert>
    </div>
  );
}

function PredefinedRow({
  entry: p,
  adopted,
  canEdit,
}: {
  entry: PredefinedAppointmentTemplate;
  adopted: AppointmentTemplate | undefined;
  canEdit: boolean;
}) {
  const t = useTranslations('appointments.templates');
  const { toast } = useToast();
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [preview, setPreview] = useState(false);
  const whatsapp = p.channel === 'whatsapp';

  async function adopt(submit: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await channelsApi.adopt({ key: p.key, channel: p.channel as AppointmentTemplateChannel, language: p.language, submit });
      refresh();
      void r;
      toast(r.metaError ? t('metaRefused') : submit && whatsapp ? t('submitted') : t('adopted'), r.metaError ? 'danger' : 'success');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 basis-40 text-sm">
          {t(`channels.${p.channel}`)}
          {whatsapp && p.metaCategory && (
            <span className="ms-2 text-xs text-muted-foreground">
              {p.metaCategory === 'MARKETING' ? t('category.MARKETING') : t('category.UTILITY')}
            </span>
          )}
        </span>
        <Button variant="secondary" size="sm" onClick={() => setPreview((v) => !v)} aria-expanded={preview}>
          {preview ? t('hidePreview') : t('preview')}
        </Button>
        {adopted ? (
          <Badge tone={STATUS_TONE[adopted.status]}>{t('inLibrary', { status: t(`status.${adopted.status}`) })}</Badge>
        ) : canEdit ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => void adopt(false)}>
              {busy ? t('adopting') : whatsapp ? t('adoptDraft') : t('adopt')}
            </Button>
            {whatsapp && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void adopt(true)}>
                {t('adoptSubmit')}
              </Button>
            )}
          </>
        ) : null}
      </div>
      {preview && (
        <div className={cn('mt-2 rounded-md border border-border bg-background p-3 text-sm')}>
          {p.subject && <p className="mb-1 font-medium">{p.subject}</p>}
          <p className="whitespace-pre-wrap break-words">{p.body}</p>
        </div>
      )}
      {error !== null && <ErrorLine error={error} className="mt-2" />}
    </div>
  );
}

// --- the owner's own email message ---------------------------------------------------------------------------------------------

function NewEmailMessage() {
  const t = useTranslations('appointments.templates');
  const { toast } = useToast();
  const refresh = useRefresh();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AppointmentMessageKind>('confirmation');
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!open) {
    return (
      <div>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          {t('newEmail')}
        </Button>
      </div>
    );
  }
  const valid = name.trim() !== '' && body.trim() !== '';
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <h3 className="text-sm font-semibold">{t('newEmail')}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium">{t('kindLabel')}</span>
          <Select value={kind} onChange={(e) => setKind(e.target.value as AppointmentMessageKind)}>
            {APPOINTMENT_MESSAGE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">{t('nameLabel')}</span>
          <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium">{t('subjectLabel')}</span>
        <Input value={subject} maxLength={191} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium">{t('bodyLabel')}</span>
        <Textarea rows={6} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
      </label>
      {error !== null && <ErrorLine error={error} />}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
        <Button
          size="sm"
          disabled={busy || !valid}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await channelsApi.createEmail({
                kind,
                channel: 'email',
                language: 'en',
                name: name.trim(),
                subject: subject.trim() || null,
                body: body.trim(),
              });
              refresh();
              toast(t('created'));
              setOpen(false);
              setName('');
              setSubject('');
              setBody('');
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t('saving') : t('create')}
        </Button>
      </div>
    </div>
  );
}
