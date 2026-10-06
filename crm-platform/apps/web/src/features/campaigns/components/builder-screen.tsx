'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Button, Field, Input, Select, Spinner, Textarea, useToast } from '@crm/ui';
import type { CampaignConfig } from '@crm/contracts';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  isUnofficialDisabledError,
  offerSenders,
  submittableSenderKey,
} from '@/lib/unofficial-whatsapp';
import { useUnofficialWhatsapp } from '@/lib/use-unofficial-whatsapp';
import { AudiencePicker } from '@/features/broadcasts/components/audience-picker';
import {
  useAttributeCatalog,
  useAudienceContacts,
  useAudienceGroups,
  useAudienceTags,
} from '@/features/broadcasts/api/compose';
import {
  KEYS,
  createCampaign,
  download,
  updateCampaign,
  useBuilder,
  useCampaignConfig,
} from '../api/campaigns';
import {
  EMPTY_FORM,
  defaultSchedule,
  editorType,
  fromConfig,
  problems,
  readFileText,
  submitKey,
  toInput,
  type BuilderForm,
  type Problem,
} from '../lib/builder-model';
import { DeliverySection } from './delivery-section';
import { ChevronLeftIcon, DownloadIcon } from './icons';
import { MessageSection, Section } from './message-section';

/** `/campaigns/create` and `/campaigns/:id/edit` (TW-CAMP-002 to 010): the builder. */
export function BuilderScreen({ id }: { id?: string }) {
  const t = useTranslations('campaigns.builder');
  const config = useCampaignConfig(id);
  const builder = useBuilder();
  const session = useSession();
  const zone = session.org.timezone ?? 'UTC';

  if (id && config.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (id && (config.isError || !config.data)) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Alert tone="danger">{t('loadError')}</Alert>
      </main>
    );
  }
  return <Builder key={id ?? 'new'} id={id} config={config.data} builder={builder} zone={zone} />;
}

function Builder({
  id,
  config,
  builder,
  zone,
}: {
  id?: string;
  config: CampaignConfig | undefined;
  builder: ReturnType<typeof useBuilder>;
  zone: string;
}) {
  const t = useTranslations('campaigns.builder');
  // Personal numbers (the unofficial engine) are offered only while the platform has switched it on.
  const unofficial = useUnofficialWhatsapp();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canContacts = useCan('record.contacts.read');
  const canGroups = useCan('record.contact-groups.read');
  const canTags = useCan('record.tags.read');
  const contacts = useAudienceContacts(canContacts);
  const groups = useAudienceGroups(canGroups);
  const tags = useAudienceTags(canTags);
  const catalog = useAttributeCatalog();

  const [form, setForm] = useState<BuilderForm>(() =>
    config
      ? fromConfig(config, zone)
      : { ...EMPTY_FORM, timezone: zone, ...defaultSchedule(new Date(), zone) },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (p: Partial<BuilderForm>) => setForm((f) => ({ ...f, ...p }));
  const editing = Boolean(id);
  const fix = problems(form);
  const minDate = useMemo(
    () => defaultSchedule(new Date(), form.timezone).sendDate,
    [form.timezone],
  );
  const data = builder.data;
  const kind = editorType(form.type);

  const submit = async (draft: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const body = toInput(
        {
          ...form,
          senderKey: submittableSenderKey(form.senderKey, data?.senders ?? [], unofficial),
        },
        { draft },
      );
      const res = id ? await updateCampaign(id, body) : await createCampaign(body);
      await qc.invalidateQueries({ queryKey: KEYS.all });
      toast(res.message, 'success');
      router.push(`/campaigns/${res.campaign.id}`);
    } catch (e) {
      setError(
        isUnofficialDisabledError(e)
          ? t('unofficialDisabled')
          : e instanceof ApiError
            ? e.message
            : t('failed'),
      );
    } finally {
      setBusy(false);
    }
  };

  const sampleCsv = async () => {
    try {
      const { blob, filename } = await download('/campaigns/sample-csv');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('failed'), 'danger');
    }
  };

  const message = (p: Problem) => t(`problems.${p}`);
  const senders = useMemo(
    () => offerSenders(data?.senders ?? [], unofficial),
    [data?.senders, unofficial],
  );
  const sender = senders.find((s) => s.key === form.senderKey);
  const bubble = form.customMessage.trim() || t('previewEmpty');

  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex items-center gap-3">
        <Link
          href={id ? `/campaigns/${id}` : '/campaigns'}
          aria-label={t('back')}
          title={t('back')}
          className="grid size-9 place-items-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted"
        >
          <ChevronLeftIcon className="size-4" />
        </Link>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {editing ? t('kickerEdit') : t('kicker')}
          </div>
          <h1 className="mt-1 text-[26px] leading-none sm:text-[32px]">
            {editing ? t('titleEdit') : t('title')}{' '}
            <span className="italic text-brand">{t('titleAccent')}</span>
          </h1>
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {builder.isError && <Alert tone="danger">{t('builderError')}</Alert>}

      <form
        className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[1fr_360px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (fix.length === 0) void submit(false);
        }}
      >
        <div className="space-y-5">
          <Section index="01" title={t('setup.title')}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={`${t('setup.name')} *`} htmlFor="camp-name">
                <Input
                  id="camp-name"
                  value={form.name}
                  maxLength={191}
                  required
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder={t('setup.namePlaceholder')}
                />
              </Field>
              <Field label={t('setup.sender')} htmlFor="camp-sender" hint={t('setup.senderHint')}>
                <Select
                  id="camp-sender"
                  value={form.senderKey}
                  onChange={(e) => patch({ senderKey: e.target.value })}
                >
                  <option value="">{t('setup.defaultSender')}</option>
                  {senders.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label} {s.phone ? `· ${s.phone}` : ''} ({s.engineLabel})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Section>

          <MessageSection form={form} patch={patch} builder={data} catalog={catalog.data} />

          <Section index="03" title={t('audience.title')}>
            <AudiencePicker
              tags={tags.data?.data ?? []}
              groups={groups.data?.data ?? []}
              contacts={contacts.data?.data ?? []}
              contactsDenied={!canContacts}
              selectedTags={form.tagIds}
              selectedGroups={form.groupIds}
              selectedContacts={form.contactIds}
              onTags={(tagIds) => patch({ tagIds })}
              onGroups={(groupIds) => patch({ groupIds })}
              onContacts={(contactIds) => patch({ contactIds })}
            />
            <Field
              label={t('audience.numbers')}
              htmlFor="camp-numbers"
              hint={t('audience.numbersHint')}
            >
              <Textarea
                id="camp-numbers"
                rows={3}
                value={form.manualNumbers}
                onChange={(e) => patch({ manualNumbers: e.target.value })}
                placeholder="919812345678, 919898765432"
                className="font-mono text-xs"
              />
            </Field>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor="camp-csv" className="text-sm font-medium">
                  {t('audience.csv')}
                </label>
                <button
                  type="button"
                  onClick={() => void sampleCsv()}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                >
                  <DownloadIcon className="size-3" />
                  {t('audience.sample')}
                </button>
              </div>
              <input
                id="camp-csv"
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-semibold"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return patch({ csvText: '' });
                  if (f.size > 5 * 1024 * 1024) {
                    toast(t('audience.csvTooBig'), 'danger');
                    e.target.value = '';
                    return patch({ csvText: '' });
                  }
                  patch({ csvText: await readFileText(f) });
                }}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{t('audience.csvHint')}</p>
            </div>
            <div className="text-xs text-muted-foreground">
              {t('audience.selected', { count: form.contactIds.length })}
            </div>
          </Section>

          <DeliverySection form={form} patch={patch} minDate={minDate} />
        </div>

        <aside className="space-y-4 xl:sticky xl:top-6">
          <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('preview')}
              </span>
              <span className="font-mono text-[10.5px] text-brand">
                {sender?.engineLabel ?? t('defaultSender')}
              </span>
            </div>
            <div className="p-4" style={{ background: '#e5ddd5' }}>
              <div
                className="max-w-[300px] rounded-2xl rounded-tl-md px-3.5 py-2.5 shadow-sm"
                style={{ background: '#fff', color: '#111' }}
              >
                {kind === 'template' ? (
                  <div className="text-[13px]">
                    <div className="font-semibold">
                      {data?.templates.find((x) => x.id === form.templateId)?.name ??
                        t('previewTemplate')}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap opacity-80">
                      {data?.templates.find((x) => x.id === form.templateId)?.body ?? ''}
                    </div>
                  </div>
                ) : kind === 'flow' ? (
                  <div className="text-[13px] opacity-70">{t('previewFlow')}</div>
                ) : (
                  <>
                    {form.customHeader.trim() && (
                      <div className="mb-1 text-[13px] font-semibold">{form.customHeader}</div>
                    )}
                    {form.mediaUrl.trim() && (
                      <div className="mb-1.5 break-all font-mono text-[11px] opacity-70">
                        📎 {form.mediaUrl.trim().split('/').pop()}
                      </div>
                    )}
                    <div
                      className={`whitespace-pre-wrap break-words text-[13px] leading-snug ${form.customMessage.trim() ? '' : 'opacity-40'}`}
                    >
                      {bubble}
                    </div>
                    {form.customFooter.trim() && (
                      <div className="mt-1 text-[11px] opacity-60">{form.customFooter}</div>
                    )}
                    {form.buttons.filter((b) => b.text.trim()).length > 0 && (
                      <div className="mt-2 space-y-1">
                        {form.buttons
                          .filter((b) => b.text.trim())
                          .map((b, i) => (
                            <div
                              key={i}
                              className="rounded-lg border border-black/10 px-2.5 py-1 text-center text-[12px]"
                              style={{ color: '#027eb5' }}
                            >
                              {b.text}
                            </div>
                          ))}
                      </div>
                    )}
                  </>
                )}
                <div className="mt-1 text-end font-mono text-[9.5px] opacity-50">12:00</div>
              </div>
            </div>
            <div className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
              {t('previewNote')}
            </div>
          </div>

          {fix.length > 0 && (
            <ul className="list-inside list-disc rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs">
              {fix.map((p) => (
                <li key={p}>{message(p)}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" className="flex-1 rounded-full" disabled={busy || fix.length > 0}>
              {t(`submit.${submitKey(form, editing)}`)}
            </Button>
            {!editing && (
              <Button
                type="button"
                variant="secondary"
                className="rounded-full"
                disabled={busy || problems(form, { draft: true }).length > 0}
                onClick={() => void submit(true)}
              >
                {t('submit.draft')}
              </Button>
            )}
          </div>
        </aside>
      </form>
    </main>
  );
}
