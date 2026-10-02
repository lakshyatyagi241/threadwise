'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CMS_PAGES,
  CMS_REGISTRY,
  CMS_SITE_SECTIONS,
  THEME_TOKENS,
  countResponseSchema,
  homepageSwitchResponseSchema,
  layoutKeys,
  operatorContentResponseSchema,
  removableSlugs,
  saveDraftResponseSchema,
  saveLayoutResponseSchema,
  type CmsEntry,
  type CmsField,
  type CmsPage,
  type CmsSection,
} from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  Switch,
  Tabs,
  Textarea,
} from '@crm/ui';
import { dirtyDrafts, effectiveValue, hasPendingDraft } from '../editor-model';
import { ActionError, ErrorBlock, LoadingBlock, NS, PageHeader, operatorFetch } from './shared';

const KEY = ['operator', 'cms', 'content'];

const parseList = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

interface Group {
  id: string;
  label: string;
  /** Content key prefix for each section: `home.hero` or `footer`. */
  sections: Array<{ prefix: string; section: CmsSection }>;
  page?: CmsPage;
}

function groups(): Group[] {
  const pages: Group[] = CMS_PAGES.map((p) => ({
    id: p,
    label: CMS_REGISTRY[p].label,
    page: p,
    sections: CMS_REGISTRY[p].sections.map((s) => ({ prefix: `${p}.${s.slug}`, section: s })),
  }));
  const site: Group = {
    id: 'site',
    label: '',
    sections: CMS_SITE_SECTIONS.map((s) => ({ prefix: s.slug, section: s })),
  };
  const theme: Group = {
    id: 'theme',
    label: '',
    sections: [
      {
        prefix: 'theme',
        section: {
          slug: 'theme',
          label: 'Colours',
          removable: false,
          fields: THEME_TOKENS.map((x) => ({
            key: x.key,
            type: 'color',
            label: x.label,
            default: x.default,
          })),
        },
      },
    ],
  };
  return [...pages, site, theme];
}

const ALL_GROUPS = groups();

/** The site editor (WD-CMS-018..026, 028): drafts per field, show/hide and order per page, publish, discard. */
export function FrontendEditor() {
  const t = useTranslations(`${NS}.frontend`);
  const tc = useTranslations(`${NS}.common`);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/cms/content', { schema: operatorContentResponseSchema, signal }),
  });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });

  const publish = useMutation({
    mutationFn: () =>
      operatorFetch('/cms/content/publish', {
        method: 'POST',
        body: { scope: 'all' },
        schema: countResponseSchema,
      }),
    onSuccess: (r) => {
      setNote(t('published', { count: r.count }));
      return refresh();
    },
  });
  const discard = useMutation({
    mutationFn: () =>
      operatorFetch('/cms/content/discard', {
        method: 'POST',
        body: { scope: 'all' },
        schema: countResponseSchema,
      }),
    onSuccess: (r) => {
      setConfirmDiscard(false);
      setNote(t('discarded', { count: r.count }));
      return refresh();
    },
  });
  const homepage = useMutation({
    mutationFn: (enabled: boolean) =>
      operatorFetch('/cms/content/homepage', {
        method: 'PUT',
        body: { enabled },
        schema: homepageSwitchResponseSchema,
      }),
    onSuccess: refresh,
  });

  const entries = useMemo(
    () => new Map<string, CmsEntry>((q.data?.entries ?? []).map((e) => [e.key, e])),
    [q.data],
  );

  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;

  const pending = q.data.pending;
  const tabLabel = (g: Group) => g.label || (g.id === 'site' ? t('site') : t('theme'));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Badge tone={pending > 0 ? 'warning' : 'neutral'}>
              {t('pending', { count: pending })}
            </Badge>
            <Button
              variant="secondary"
              disabled={pending === 0 || discard.isPending}
              onClick={() => setConfirmDiscard(true)}
            >
              {t('discard')}
            </Button>
            <Button disabled={pending === 0 || publish.isPending} onClick={() => publish.mutate()}>
              {t('publish')}
            </Button>
          </>
        }
      />
      {note && <Alert tone="success">{note}</Alert>}
      <ActionError error={publish.error ?? discard.error ?? homepage.error} />
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t('homepage')}</p>
          <p className="text-xs text-muted-foreground">{t('homepageHint')}</p>
        </div>
        <Switch
          checked={q.data.homepageEnabled}
          label={t('homepage')}
          disabled={homepage.isPending}
          onCheckedChange={(v) => homepage.mutate(v)}
        />
      </Card>
      <Tabs
        items={ALL_GROUPS.map((g) => ({
          id: g.id,
          label: tabLabel(g),
          content: <GroupEditor group={g} entries={entries} onChanged={refresh} />,
        }))}
      />
      <ConfirmDialog
        open={confirmDiscard}
        title={t('discardConfirmTitle')}
        message={t('discardConfirmMessage')}
        confirmLabel={t('discard')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={discard.isPending}
        onConfirm={() => discard.mutate()}
        onClose={() => setConfirmDiscard(false)}
      />
    </div>
  );
}

function GroupEditor({
  group,
  entries,
  onChanged,
}: {
  group: Group;
  entries: ReadonlyMap<string, CmsEntry>;
  onChanged: () => void;
}) {
  const t = useTranslations(`${NS}.frontend`);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const fields = useMemo(() => {
    const m = new Map<string, CmsField>();
    for (const { prefix, section } of group.sections)
      for (const fld of section.fields) m.set(`${prefix}.${fld.key}`, fld);
    return m;
  }, [group]);

  const save = useMutation({
    mutationFn: () =>
      operatorFetch('/cms/content/draft', {
        method: 'PUT',
        body: { entries: dirtyDrafts(edits, entries, fields) },
        schema: saveDraftResponseSchema,
      }),
    onSuccess: () => {
      setEdits({});
      onChanged();
    },
  });
  const dirty = dirtyDrafts(edits, entries, fields);

  return (
    <div className="space-y-4">
      {group.page && <Layout page={group.page} entries={entries} onChanged={onChanged} />}
      <ActionError error={save.error} />
      {save.isSuccess && dirty.length === 0 && <Alert tone="success">{t('saved')}</Alert>}
      {group.sections.map(({ prefix, section }) => (
        <Card key={prefix} className="space-y-3">
          <h2 className="text-sm font-semibold">{section.label}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {section.fields.map((fld) => {
              const key = `${prefix}.${fld.key}`;
              const entry = entries.get(key);
              const value = edits[key] ?? effectiveValue(entry, fld);
              const long = fld.type === 'longtext' || fld.type === 'richtext';
              const id = `fe-${key}`;
              return (
                <div key={key} className={long ? 'sm:col-span-2' : undefined}>
                  <Field
                    label={
                      <span className="flex items-center gap-2">
                        {fld.label}
                        {key in edits && edits[key] !== effectiveValue(entry, fld) && (
                          <Badge tone="warning">{t('dirty')}</Badge>
                        )}
                        {!(key in edits) && hasPendingDraft(entry) && (
                          <Badge tone="neutral">{t('hasDraft')}</Badge>
                        )}
                      </span>
                    }
                    htmlFor={id}
                  >
                    {long ? (
                      <Textarea
                        id={id}
                        rows={fld.type === 'richtext' ? 3 : 4}
                        value={value}
                        onChange={(e) => setEdits((s) => ({ ...s, [key]: e.target.value }))}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        {fld.type === 'color' && (
                          <span
                            aria-hidden
                            className="size-6 shrink-0 rounded border border-border"
                            style={{ backgroundColor: value }}
                          />
                        )}
                        <Input
                          id={id}
                          value={value}
                          dir={fld.type === 'link' || fld.type === 'color' ? 'ltr' : undefined}
                          onChange={(e) => setEdits((s) => ({ ...s, [key]: e.target.value }))}
                        />
                      </div>
                    )}
                  </Field>
                  {value !== fld.default && (
                    <button
                      type="button"
                      className="mt-1 text-xs underline"
                      onClick={() => setEdits((s) => ({ ...s, [key]: fld.default }))}
                    >
                      {t('resetField')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ))}
      <div>
        <Button disabled={dirty.length === 0 || save.isPending} onClick={() => save.mutate()}>
          {t('saveSection')}
        </Button>
      </div>
    </div>
  );
}

/** Show, hide and reorder the removable sections of one page (WD-CMS-022, 023). Saved as a draft layout. */
function Layout({
  page,
  entries,
  onChanged,
}: {
  page: CmsPage;
  entries: ReadonlyMap<string, CmsEntry>;
  onChanged: () => void;
}) {
  const keys = layoutKeys(page);
  const removable = removableSlugs(page);
  const hidden = parseList(entries.get(keys.hidden)?.draft ?? entries.get(keys.hidden)?.published);
  const saved = parseList(entries.get(keys.order)?.draft ?? entries.get(keys.order)?.published);
  const order = [
    ...saved.filter((s, i) => removable.includes(s) && saved.indexOf(s) === i),
    ...removable.filter((s) => !saved.includes(s)),
  ];
  const label = (slug: string) =>
    CMS_REGISTRY[page].sections.find((s) => s.slug === slug)?.label ?? slug;

  const save = useMutation({
    mutationFn: (next: { hidden?: string[]; order?: string[] }) =>
      operatorFetch('/cms/content/layout', {
        method: 'PUT',
        body: { page, ...next },
        schema: saveLayoutResponseSchema,
      }),
    onSuccess: onChanged,
  });
  if (removable.length === 0) return null;
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    save.mutate({ order: next });
  };

  return (
    <Card className="space-y-2">
      <ActionError error={save.error} />
      <ul className="divide-y divide-border">
        {order.map((slug, i) => (
          <li key={slug} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1 text-sm">{label(slug)}</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={i === 0 || save.isPending}
              onClick={() => move(i, -1)}
              aria-label={`${label(slug)} up`}
            >
              ↑
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={i === order.length - 1 || save.isPending}
              onClick={() => move(i, 1)}
              aria-label={`${label(slug)} down`}
            >
              ↓
            </Button>
            <Switch
              checked={!hidden.includes(slug)}
              label={label(slug)}
              disabled={save.isPending}
              onCheckedChange={(show) =>
                save.mutate({
                  hidden: show ? hidden.filter((h) => h !== slug) : [...hidden, slug],
                })
              }
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}
