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

const inputCls = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10';

/** `/admin/flow-templates/new` and `/{id}/edit` (WD-FLB-012). */
export function AdminTemplateFormScreen({ id }: { id?: string }) {
  const q = useQuery({ queryKey: [...FLB_KEYS.admin, 'one', id], queryFn: () => adminTemplatesApi.get(id!), enabled: !!id, gcTime: 0 });
  if (id && q.isPending) return <div className="py-10 text-center text-sm text-muted-foreground">…</div>;
  if (id && q.isError) return <div role="alert" className="py-10 text-center text-sm">Template not found.</div>;
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
    const errs: string[] = [];
    if (!name.trim()) errs.push(t('nameRequired'));
    const sort = Number.parseInt(sortOrder || '0', 10);
    if (!Number.isInteger(sort) || sort < 0 || sort > 9999) errs.push(t('sortRange'));

    // Graph source precedence: the uploaded file, then the pasted JSON, then a flow id.
    let payload: Record<string, unknown> | undefined;
    const parse = (text: string): Record<string, unknown> | undefined => {
      try {
        const j: unknown = JSON.parse(text);
        return typeof j === 'object' && j !== null && !Array.isArray(j) ? (j as Record<string, unknown>) : undefined;
      } catch {
        return undefined;
      }
    };
    let fileUsable = false;
    if (file && file.size <= FLOW_IMPORT_MAX_BYTES) {
      // A file that is not valid JSON counts as "no graph supplied" (WaDesk's quirk, kept).
      const p = parse(await file.text());
      if (p) {
        payload = p;
        fileUsable = true;
      }
    }
    if (!fileUsable && pasted.trim()) {
      payload = parse(pasted);
      if (!payload) errs.push(t('notJson'));
    }
    let source: string | undefined;
    if (!payload && !errs.length && sourceFlowId.trim()) {
      if (uuidSchema.safeParse(sourceFlowId.trim()).success) source = sourceFlowId.trim();
      else errs.push(t('graphRequired'));
    }
    if (!editing && !payload && !source && !errs.length) errs.push(t('graphRequired'));
    if (errs.length) return setErrors(errs);

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
      if (template) await adminTemplatesApi.update(template.id, { ...base, rowVersion: template.rowVersion });
      else await adminTemplatesApi.create(base);
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
    <form onSubmit={(e) => void submit(e)} className="flb-root space-y-5" noValidate data-testid="admin-template-form">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <nav className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground" aria-label="Breadcrumb">
            {t('breadcrumbAdmin')} › <Link href="/admin/flow-templates" className="hover:underline">{t('breadcrumbTemplates')}</Link> › {editing ? t('edit') : t('new')}
          </nav>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{editing ? template.name : t('create')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/flow-templates" className="rounded-full border border-border px-4 py-2 text-[13px] hover:bg-muted">{t('cancel')}</Link>
          <button type="submit" disabled={busy} className="rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-60">
            {editing ? t('save') : t('create')}
          </button>
        </div>
      </header>

      {errors.length ? (
        <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-danger">
          <div className="font-semibold">{t('errorsTitle')}</div>
          <ul className="mt-1 list-disc pl-5">{errors.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <section className="space-y-4 rounded-2xl border border-border bg-background p-5">
            <h2 className="font-serif text-lg">{t('details')}</h2>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">{t('name')}</span>
              <input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} className={inputCls} />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">{t('description')}</span>
              <textarea value={description} maxLength={1000} rows={3} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
              <span className="mt-1 block text-xs text-muted-foreground">{t('descriptionHint')}</span>
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">{t('category')}</span>
              <input value={category} maxLength={64} onChange={(e) => setCategory(e.target.value)} placeholder={t('categoryPlaceholder')} className={inputCls} />
            </label>
          </section>

          <section className="space-y-4 rounded-2xl border border-border bg-background p-5">
            <h2 className="font-serif text-lg">{t('flowTitle')}</h2>
            {editing ? <p className="text-sm text-muted-foreground">{t('currently', { count: template.steps })}</p> : null}
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">{t('upload')}</span>
              <input type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">{t('paste')}</span>
              <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={6} placeholder={t('pastePlaceholder')} spellCheck={false} className={`${inputCls} bg-[#1E2A33] font-mono text-[12px] text-[#7CF3C4]`} />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">{t('clone')}</span>
              <input value={sourceFlowId} onChange={(e) => setSourceFlowId(e.target.value)} className={`${inputCls} font-mono`} />
              <span className="mt-1 block text-xs text-muted-foreground">{t('cloneHint')}</span>
            </label>
          </section>
        </div>

        <aside className="space-y-4 self-start rounded-2xl border border-border bg-background p-5">
          <h2 className="font-serif text-lg">{t('visibility')}</h2>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">{t('flowType')}</span>
            <select value={flowType} onChange={(e) => setFlowType(e.target.value)} className={inputCls}>
              <option value="chat">{t('typeChat')}</option>
              <option value="call">{t('typeCall')}</option>
              <option value="instagram">{t('typeInstagram')}</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">{t('sortOrder')}</span>
            <input type="number" min={0} max={9999} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={inputCls} />
            <span className="mt-1 block text-xs text-muted-foreground">{t('sortHint')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t('isActive')}
          </label>
        </aside>
      </div>
    </form>
  );
}
