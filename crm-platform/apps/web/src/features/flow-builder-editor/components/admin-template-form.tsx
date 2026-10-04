'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  FLOW_IMPORT_MAX_BYTES,
  FLB_TEMPLATE_FLOW_TYPES,
  uuidSchema,
  type AdminFlowTemplateDetail,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { adminTemplatesApi } from '../api/flows';
import { FLB_KEYS } from '../api/hooks';

/** Upload types WaDesk accepts for the flow file (`mimetypes:application/json,text/plain,text/json`). */
const FILE_TYPES = ['application/json', 'text/plain', 'text/json'];
/** The "Template saved." notice WaDesk flashes onto the list after a save; the list shows it once. */
export const ADMIN_FLASH_KEY = 'flb:admin-flash';
const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10';

/** `/admin/flow-templates/new` and `/{id}/edit` (WD-FLB-012). */
export function AdminTemplateFormScreen({ id }: { id?: string }) {
  const q = useQuery({
    queryKey: [...FLB_KEYS.admin, 'one', id],
    queryFn: () => adminTemplatesApi.get(id!),
    enabled: !!id,
    gcTime: 0,
  });
  if (id && q.isPending)
    return <div className="py-10 text-center text-sm text-muted-foreground">…</div>;
  if (id && q.isError)
    return (
      <div role="alert" className="py-10 text-center text-sm">
        Template not found.
      </div>
    );
  return <TemplateForm key={id ?? 'new'} template={q.data ?? null} />;
}

function TemplateForm({ template }: { template: AdminFlowTemplateDetail | null }) {
  const t = useTranslations('flb.admin.form');
  const router = useRouter();
  const editing = template !== null;
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [category, setCategory] = useState(template?.category ?? '');
  const [flowType, setFlowType] = useState<string>(template?.flowType ?? 'chat');
  const [sortOrder, setSortOrder] = useState(String(template?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState('');
  const [sourceFlowId, setSourceFlowId] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // The checks WaDesk's request validation runs first, in its order and words.
    const errs: string[] = [];
    if (!name.trim()) errs.push(t('nameRequired'));
    const sortRaw = sortOrder.trim();
    const sort = sortRaw === '' ? 0 : Number(sortRaw);
    if (sortRaw !== '' && !Number.isInteger(sort)) errs.push(t('sortInteger'));
    else if (sort < 0) errs.push(t('sortMin'));
    else if (sort > 9999) errs.push(t('sortMax'));
    if (file) {
      if (file.size > FLOW_IMPORT_MAX_BYTES) errs.push(t('fileTooLarge'));
      else if (file.size === 0 || (file.type && !FILE_TYPES.includes(file.type)))
        errs.push(t('fileType'));
    }
    if (errs.length) return setErrors(errs);

    // Graph source precedence: the uploaded file, then the pasted JSON, then a flow id; the first one supplied is the only one
    // read. JSON that cannot be read is sent as `{}`: "supplied, but no graph in it" (the server answers as WaDesk does: a create
    // asks for the flow, an edit keeps the current one). QUIRK kept: no warning for a file that is not JSON.
    const parse = (text: string): Record<string, unknown> => {
      try {
        const j: unknown = JSON.parse(text);
        return typeof j === 'object' && j !== null && !Array.isArray(j)
          ? (j as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    };
    let payload: Record<string, unknown> | undefined;
    let source: string | undefined;
    if (file) payload = parse(await file.text());
    else if (pasted.trim()) payload = parse(pasted);
    else if (sourceFlowId.trim()) {
      if (uuidSchema.safeParse(sourceFlowId.trim()).success) source = sourceFlowId.trim();
      else payload = {}; // not a flow id of this platform: nothing found, as an unknown id was in WaDesk
    }

    setBusy(true);
    setErrors([]);
    const base = {
      name: name.trim(),
      description: description.trim() || null,
      category: category.trim() || null,
      flowType: flowType as (typeof FLB_TEMPLATE_FLOW_TYPES)[number],
      sortOrder: sort,
      isActive,
      ...(payload ? { payload } : {}),
      ...(source ? { sourceFlowId: source } : {}),
    };
    try {
      if (template)
        await adminTemplatesApi.update(template.id, { ...base, rowVersion: template.rowVersion });
      else await adminTemplatesApi.create(base);
      try {
        sessionStorage.setItem(ADMIN_FLASH_KEY, t('saved'));
      } catch {
        /* private mode: the notice is a convenience */
      }
      router.push('/admin/flow-templates');
    } catch (err) {
      setErrors(
        err instanceof ApiError
          ? err.code === 'ROW_VERSION_CONFLICT'
            ? [t('conflict')]
            : err.fieldErrors.length
              ? err.fieldErrors.map((f) => f.message)
              : [err.message]
          : [String((err as Error).message)],
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flb-root space-y-5"
      noValidate
      data-testid="admin-template-form"
    >
      <nav className="font-mono text-[12px] text-muted-foreground" aria-label="Breadcrumb">
        <span className="tracking-[0.16em] uppercase">{t('breadcrumbAdmin')}</span> ›{' '}
        <Link href="/admin/flow-templates" className="hover:text-foreground">
          {t('breadcrumbTemplates')}
        </Link>{' '}
        › <span className="text-foreground">{editing ? t('edit') : t('new')}</span>
      </nav>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('eyebrow')}
            {editing ? t('edit') : t('new')}
          </div>
          <h1 className="font-serif text-[28px] leading-none font-normal tracking-tight sm:text-[36px]">
            {editing ? t('edit') : t('new')}{' '}
            <span className="text-brand italic">{t('titleAccent')}</span>
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/flow-templates"
            className="rounded-full border border-border bg-background px-3.5 py-1.5 text-[12px] font-medium hover:bg-muted"
          >
            {t('cancel')}
          </Link>
          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-2 rounded-full bg-brand px-4 py-1.5 text-[12px] font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-60"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M2 8l5 5 7-9" />
            </svg>
            {editing ? t('save') : t('create')}
          </button>
        </div>
      </header>

      {errors.length ? (
        <div
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-danger"
        >
          <div className="font-semibold">{t('errorsTitle')}</div>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="border-b border-border px-5 py-4">
              <div className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
                {t('detailsKicker')}
              </div>
              <h2 className="mt-1 font-serif text-[22px] leading-tight">{t('details')}</h2>
            </div>
            <div className="space-y-4 p-5">
              <label className="block space-y-1.5">
                <span className="text-[11.5px] font-semibold">
                  {t('name')} <span className="text-[var(--flb-coral)]">*</span>
                </span>
                <input
                  value={name}
                  maxLength={160}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('namePlaceholder')}
                  className={`${inputCls} text-[14px]`}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11.5px] font-semibold">{t('description')}</span>
                <textarea
                  value={description}
                  maxLength={1000}
                  rows={2}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('descriptionHint')}
                  className={inputCls}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11.5px] font-semibold">{t('category')}</span>
                <input
                  value={category}
                  maxLength={64}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder={t('categoryPlaceholder')}
                  className={inputCls}
                />
              </label>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="border-b border-border px-5 py-4">
              <div className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
                {t('flowKicker')}
              </div>
              <h2 className="mt-1 font-serif text-[22px] leading-tight">{t('flowTitle')}</h2>
            </div>
            <div className="space-y-4 p-5">
              {editing ? (
                <div className="rounded-xl border border-border bg-muted/50 px-3 py-2.5 text-[12px] text-foreground/70">
                  {t('currently', { count: template.steps })}
                </div>
              ) : (
                <p className="text-[12.5px] text-foreground/70">{t('provide')}</p>
              )}
              <label className="block space-y-1.5">
                <span className="text-[11.5px] font-semibold">{t('upload')}</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-[12.5px] file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-brand-foreground"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11.5px] font-semibold">{t('paste')}</span>
                <textarea
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  rows={6}
                  placeholder={t('pastePlaceholder')}
                  spellCheck={false}
                  className={`${inputCls} !bg-[#0F1720] font-mono text-[11.5px] leading-relaxed !text-[#D7E3DC] placeholder:text-[#D7E3DC]/50`}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11.5px] font-semibold">{t('clone')}</span>
                <input
                  value={sourceFlowId}
                  onChange={(e) => setSourceFlowId(e.target.value)}
                  placeholder={t('cloneHint')}
                  className={inputCls}
                />
              </label>
            </div>
          </section>
        </div>

        <aside className="self-start overflow-hidden rounded-2xl border border-border bg-background shadow-sm lg:sticky lg:top-6">
          <div className="border-b border-border px-5 py-4">
            <div className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
              {t('settingsKicker')}
            </div>
            <h2 className="mt-1 font-serif text-[22px] leading-tight">{t('visibility')}</h2>
          </div>
          <div className="space-y-4 p-5">
            <label className="block space-y-1.5">
              <span className="text-[11.5px] font-semibold">{t('flowType')}</span>
              <select
                value={flowType}
                onChange={(e) => setFlowType(e.target.value)}
                className={inputCls}
              >
                <option value="chat">{t('typeChat')}</option>
                <option value="call">{t('typeCall')}</option>
                <option value="instagram">{t('typeInstagram')}</option>
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11.5px] font-semibold">{t('sortOrder')}</span>
              <input
                type="number"
                min={0}
                max={9999}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className={inputCls}
              />
              <span className="block text-[11px] text-muted-foreground">{t('sortHint')}</span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 pt-1">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
              />
              <span className="text-[12.5px] text-foreground/80">{t('isActive')}</span>
            </label>
          </div>
          <div className="border-t border-border px-5 py-4">
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-full bg-brand px-4 py-2 text-[12.5px] font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-60"
            >
              {editing ? t('save') : t('create')}
            </button>
          </div>
        </aside>
      </div>
    </form>
  );
}
