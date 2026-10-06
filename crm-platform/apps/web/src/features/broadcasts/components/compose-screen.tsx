'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Button, Field, Input, Select, Spinner, EmptyState, useToast } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  isUnofficialDisabledError,
  offerSenders,
  submittableSenderKeys,
} from '@/lib/unofficial-whatsapp';
import { useUnofficialWhatsapp } from '@/lib/use-unofficial-whatsapp';
import { KEYS } from '../api/broadcasts';
import {
  createBroadcast,
  useAttributeCatalog,
  useAudienceContacts,
  useAudienceGroups,
  useAudienceTags,
  useCompose,
} from '../api/compose';
import {
  buildBody,
  defaultSchedule,
  EMPTY_FORM,
  problems,
  templateOptionLabel,
  type ComposeForm,
} from '../lib/compose-model';
import { AudiencePicker } from './audience-picker';
import { ComposePreview } from './compose-preview';
import { OverridesPanel } from './overrides-panel';
import { ChevronLeftIcon } from './icons';
import { ScheduleSection } from './schedule-section';
import { SenderPicker } from './sender-picker';

const INPUT = 'text-[12.5px]';

/**
 * `/broadcasts/create` (TW-BCAST-004 to 008): the setup, the sender and audience pickers and the schedule on the left, the
 * template preview on the right. Nothing is sent until "Add Broadcast"; the server checks the plan, the audience, the template
 * and the wallet, and its refusal is shown here.
 */
export function ComposeScreen() {
  const t = useTranslations('broadcasts.compose');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const session = useSession();
  const canContacts = useCan('record.contacts.read');
  const canGroups = useCan('record.contact-groups.read');
  const canTags = useCan('record.tags.read');

  const compose = useCompose();
  // Personal numbers (the unofficial engine) are offered only while the platform has switched it on.
  const unofficial = useUnofficialWhatsapp();
  const contacts = useAudienceContacts(canContacts);
  const groups = useAudienceGroups(canGroups);
  const tags = useAudienceTags(canTags);
  const catalog = useAttributeCatalog();

  const zone = session.org.timezone ?? 'UTC';
  const [form, setForm] = useState<ComposeForm>(() => ({
    ...EMPTY_FORM,
    timezone: zone,
    ...defaultSchedule(new Date(), zone),
  }));
  const [picked, setPicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (p: Partial<ComposeForm>) => setForm((f) => ({ ...f, ...p }));

  const data = compose.data;
  // With one connected number there is nothing to pick: it is used as is.
  const senders = useMemo(
    () => offerSenders(data?.senders ?? [], unofficial),
    [data?.senders, unofficial],
  );
  const onlySender = senders.length === 1 ? senders[0]!.key : null;
  const template = data?.templates.find((x) => x.id === form.templateId);
  const minDate = useMemo(
    () => defaultSchedule(new Date(), form.timezone).sendDate,
    [form.timezone],
  );
  const selected = form.contactIds.length;
  const fix = problems(form);

  const submit = async () => {
    setPicked(true);
    setError(null);
    if (fix.length > 0) return;
    setBusy(true);
    try {
      const body = buildBody({
        ...form,
        senderKeys: onlySender ? [onlySender] : submittableSenderKeys(form.senderKeys, unofficial),
      });
      const res = await createBroadcast(body);
      toast(
        res.broadcasts.length > 1
          ? t('createdMany', { count: res.broadcasts.length })
          : t('created'),
        'success',
      );
      void qc.invalidateQueries({ queryKey: KEYS.all });
      router.push('/broadcasts');
    } catch (e) {
      setError(
        isUnofficialDisabledError(e)
          ? t('unofficialDisabled')
          : e instanceof ApiError
            ? e.message
            : t('failed'),
      );
      setBusy(false);
    }
  };

  if (compose.isPending) {
    return (
      <div className="flex justify-center p-16">
        <Spinner label={t('loading')} />
      </div>
    );
  }
  if (compose.isError || !data) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <EmptyState
          title={t('loadError')}
          message={compose.error instanceof ApiError ? compose.error.message : undefined}
          actions={
            <Button variant="secondary" onClick={() => void compose.refetch()}>
              {t('retry')}
            </Button>
          }
        />
      </div>
    );
  }

  const twilioHint = data.twilioEnabled;
  const err = (k: 'name' | 'template' | 'schedule') =>
    picked && fix.includes(k)
      ? t(`fix${k.charAt(0).toUpperCase()}${k.slice(1)}` as 'fixName')
      : undefined;

  return (
    <>
      <div className="sticky top-0 z-20 border-b border-border bg-background">
        <div className="mx-auto flex max-w-none items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/broadcasts"
              title={t('back')}
              aria-label={t('back')}
              className="grid size-8 place-items-center rounded-full border border-border hover:bg-muted"
            >
              <ChevronLeftIcon className="size-3.5 rtl:rotate-180" />
            </Link>
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('crumb')}
              </div>
              <div className="truncate text-xl leading-tight">
                {t('title')} <span className="italic text-brand">{t('titleAccent')}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] font-medium sm:inline-flex">
              {t('draft')}
            </span>
            <Button
              size="sm"
              variant="brand"
              className="rounded-full"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? t('submitting') : t('submit')}
            </Button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-none px-4 py-6 sm:px-6 lg:px-7">
        {error && (
          <Alert tone="danger" className="mb-4">
            {error}
          </Alert>
        )}
        <form
          className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_342px]"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="border-b border-border bg-muted/40 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex size-[23px] shrink-0 items-center justify-center rounded-[7px] bg-background font-mono text-[10px] font-semibold text-brand">
                  01
                </span>
                <span className="flex-1 text-lg leading-none">{t('setup')}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {t('templateMessage')}
                </span>
              </div>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label={
                    <>
                      {t('name')} <span className="text-danger">*</span>
                    </>
                  }
                  htmlFor="broadcastName"
                  hint={t('nameHint')}
                  error={err('name')}
                >
                  <Input
                    id="broadcastName"
                    value={form.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    placeholder={t('namePlaceholder')}
                    className={INPUT}
                    invalid={Boolean(err('name'))}
                  />
                </Field>
                <Field
                  label={
                    <>
                      {t('template')} <span className="text-danger">*</span>
                    </>
                  }
                  htmlFor="templateSelect"
                  error={err('template')}
                  hint={
                    data.templates.length === 0
                      ? undefined
                      : twilioHint
                        ? t('twilioHint')
                        : t('templateHint')
                  }
                >
                  <Select
                    id="templateSelect"
                    value={form.templateId}
                    onChange={(e) => patch({ templateId: e.target.value, overrides: null })}
                    className={INPUT}
                    invalid={Boolean(err('template'))}
                  >
                    <option value="">{t('pickTemplate')}</option>
                    {data.templates.map((x) => (
                      <option key={x.id} value={x.id}>
                        {templateOptionLabel(x, twilioHint)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {template && (
                <OverridesPanel
                  key={template.id}
                  template={template}
                  catalog={catalog.data}
                  onChange={(overrides) => patch({ overrides })}
                />
              )}
              {data.templates.length === 0 && (
                <div className="-mt-3 text-[10.5px] text-danger">
                  {t('noTemplates')}{' '}
                  <Link href="/templates/create" className="font-semibold hover:underline">
                    {t('createOne')}
                  </Link>
                </div>
              )}

              <SenderPicker
                senders={senders}
                unofficialEnabled={unofficial}
                checked={form.senderKeys}
                shares={form.shares}
                onChecked={(key, on) =>
                  patch({
                    senderKeys: on
                      ? [...form.senderKeys, key]
                      : form.senderKeys.filter((k) => k !== key),
                  })
                }
                onShare={(key, w) =>
                  patch({ shares: { ...form.shares, [key]: Number.isFinite(w) ? w : 0 } })
                }
              />

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

              <ScheduleSection
                type={form.scheduleType}
                date={form.sendDate}
                time={form.sendTime}
                timezone={form.timezone}
                minDate={minDate}
                onType={(scheduleType) => patch({ scheduleType })}
                onDate={(sendDate) => patch({ sendDate })}
                onTime={(sendTime) => patch({ sendTime })}
                onTimezone={(timezone) => patch({ timezone })}
              />
              {err('schedule') && <p className="text-xs text-danger">{err('schedule')}</p>}
            </div>
          </section>

          <aside className="space-y-4">
            <ComposePreview
              template={template}
              selected={selected}
              later={form.scheduleType === 'later'}
            />
          </aside>
        </form>
      </main>
    </>
  );
}
