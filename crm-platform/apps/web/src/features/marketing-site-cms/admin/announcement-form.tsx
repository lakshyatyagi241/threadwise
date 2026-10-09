'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ANNOUNCEMENT_TONES,
  announcementSchema,
  type Announcement,
  type AnnouncementTone,
} from '@crm/contracts';
import { Alert, Button, Card, Field, Input, Select, Switch, Textarea } from '@crm/ui';
import { ANNOUNCEMENTS_KEY } from './announcements';
import { ActionError, ErrorBlock, LoadingBlock, NS, PageHeader, operatorFetch } from './shared';
import { browserZone, instantToLocal, localToInstant, zoneList } from './zoned-time';

/** Create and edit a marquee announcement (WD-CMS-040). `id` absent means a new one. */
export function AnnouncementForm({ id }: { id?: string }) {
  const row = useQuery({
    queryKey: [...ANNOUNCEMENTS_KEY, id],
    enabled: !!id,
    queryFn: ({ signal }) =>
      operatorFetch(`/cms/announcements/${id}`, { schema: announcementSchema, signal }),
  });
  // The zone list and the default zone come from the browser, so the form renders after mount (no hydration mismatch).
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  if (!mounted || (id && row.isPending)) return <LoadingBlock />;
  if (id && row.isError) return <ErrorBlock error={row.error} onRetry={() => void row.refetch()} />;
  return <Editor key={row.data?.rowVersion ?? 'new'} row={row.data} />;
}

function Section({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <Card className="space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="font-mono text-xs text-muted-foreground">{n}</span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} label={label} onCheckedChange={onChange} />
    </div>
  );
}

function Editor({ row }: { row: Announcement | undefined }) {
  const t = useTranslations(`${NS}.announcements.form`);
  const ta = useTranslations(`${NS}.announcements`);
  const tc = useTranslations(`${NS}.common`);
  const router = useRouter();
  const qc = useQueryClient();
  const zone0 = useMemo(() => browserZone(), []);
  const [zone, setZone] = useState(zone0);
  const zones = useMemo(() => zoneList(zone0), [zone0]);
  const [f, setF] = useState({
    text: row?.text ?? '',
    tone: (row?.tone ?? 'info') as AnnouncementTone,
    linkUrl: row?.linkUrl ?? '',
    linkLabel: row?.linkLabel ?? '',
    isActive: row?.isActive ?? true,
    dismissible: row?.dismissible ?? true,
    startsAt: instantToLocal(row?.startsAt ?? null, zone0),
    expiresAt: instantToLocal(row?.expiresAt ?? null, zone0),
    sortOrder: String(row?.sortOrder ?? 0),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const [saved, setSaved] = useState(false);

  /** Changing the zone keeps the instants and shows them as wall-clock times in the new zone. */
  const changeZone = (next: string) => {
    setF((s) => ({
      ...s,
      startsAt: instantToLocal(localToInstant(s.startsAt, zone), next),
      expiresAt: instantToLocal(localToInstant(s.expiresAt, zone), next),
    }));
    setZone(next);
  };

  const starts = localToInstant(f.startsAt, zone);
  const expires = localToInstant(f.expiresAt, zone);
  const windowBad = !!starts && !!expires && new Date(expires) < new Date(starts);

  const save = useMutation({
    mutationFn: () => {
      const blank = (v: string) => (v.trim() === '' ? null : v.trim());
      const body = {
        text: f.text.trim(),
        tone: f.tone,
        linkUrl: blank(f.linkUrl),
        linkLabel: blank(f.linkLabel),
        isActive: f.isActive,
        dismissible: f.dismissible,
        startsAt: starts,
        expiresAt: expires,
        sortOrder: Math.min(9999, Math.max(0, Math.trunc(Number(f.sortOrder) || 0))),
      };
      return row
        ? operatorFetch(`/cms/announcements/${row.id}`, {
            method: 'PUT',
            body: { ...body, rowVersion: row.rowVersion },
            schema: announcementSchema,
          })
        : operatorFetch('/cms/announcements', {
            method: 'POST',
            body,
            schema: announcementSchema,
          });
    },
    onSuccess: (r) => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ANNOUNCEMENTS_KEY });
      if (!row) router.replace(`/admin/announcements/${r.id}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <PageHeader
        eyebrow={row ? t('eyebrowEdit') : t('eyebrowNew')}
        title={row ? row.text.slice(0, 80) : t('titleNew')}
        description={row ? undefined : t('introNew')}
        actions={
          <>
            <Link href="/admin/announcements" className="text-sm underline">
              {tc('cancel')}
            </Link>
            <Button type="submit" disabled={save.isPending || f.text.trim() === '' || windowBad}>
              {row ? t('saveChanges') : t('create')}
            </Button>
          </>
        }
      />
      {saved && <Alert tone="success">{t('saved')}</Alert>}
      <ActionError error={save.error} />
      {windowBad && <Alert tone="danger">{t('windowBad')}</Alert>}

      <Section n="01" title={t('sectionMessage')}>
        <Field label={t('text')} htmlFor="an-text" hint={t('textHint')}>
          <Textarea
            id="an-text"
            rows={3}
            required
            maxLength={500}
            value={f.text}
            onChange={(e) => set('text', e.target.value)}
            placeholder={t('textPlaceholder')}
          />
        </Field>
        <Field label={t('tone')} htmlFor="an-tone">
          <Select
            id="an-tone"
            value={f.tone}
            onChange={(e) => set('tone', e.target.value as AnnouncementTone)}
          >
            {ANNOUNCEMENT_TONES.map((k) => (
              <option key={k} value={k}>
                {ta(`toneOption_${k}`)}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      <Section n="02" title={t('sectionLink')}>
        <Field label={t('linkUrl')} htmlFor="an-url" hint={t('linkUrlHint')}>
          <Input
            id="an-url"
            dir="ltr"
            maxLength={500}
            value={f.linkUrl}
            onChange={(e) => set('linkUrl', e.target.value)}
            placeholder={t('linkUrlPlaceholder')}
          />
        </Field>
        <Field label={t('linkLabel')} htmlFor="an-label" hint={t('linkLabelHint')}>
          <Input
            id="an-label"
            maxLength={64}
            value={f.linkLabel}
            onChange={(e) => set('linkLabel', e.target.value)}
            placeholder={t('linkLabelPlaceholder')}
          />
        </Field>
        <Toggle
          label={t('active')}
          hint={t('activeHint')}
          checked={f.isActive}
          onChange={(v) => set('isActive', v)}
        />
        <Toggle
          label={t('dismissible')}
          hint={t('dismissibleHint')}
          checked={f.dismissible}
          onChange={(v) => set('dismissible', v)}
        />
      </Section>

      <Section n="03" title={t('sectionSchedule')}>
        <Field label={t('timezone')} htmlFor="an-tz" hint={t('timezoneHint')}>
          <Select id="an-tz" value={zone} onChange={(e) => changeZone(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('startsAt')} htmlFor="an-start" hint={t('startsAtHint')}>
            <Input
              id="an-start"
              type="datetime-local"
              value={f.startsAt}
              onChange={(e) => set('startsAt', e.target.value)}
            />
          </Field>
          <Field label={t('expiresAt')} htmlFor="an-exp" hint={t('expiresAtHint')}>
            <Input
              id="an-exp"
              type="datetime-local"
              value={f.expiresAt}
              onChange={(e) => set('expiresAt', e.target.value)}
            />
          </Field>
        </div>
        <Field label={t('sortOrder')} htmlFor="an-sort" hint={t('sortOrderHint')}>
          <Input
            id="an-sort"
            type="number"
            min={0}
            max={9999}
            value={f.sortOrder}
            onChange={(e) => set('sortOrder', e.target.value)}
          />
        </Field>
      </Section>
    </form>
  );
}
