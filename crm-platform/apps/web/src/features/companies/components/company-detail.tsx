'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, ConfirmDialog, EmptyState, Spinner, StatTile, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { companiesApi, invalidateCompanies, useCompany } from '../api/companies';
import { LinkedTasks } from '@/features/tasks';
import { errorKind } from '../lib/errors';
import { websiteHref } from '../lib/form';
import { formatTotals } from '../lib/money';
import { ActivityCard } from './activity-card';
import { CompanyFormModal } from './company-form-modal';
import { ErrorLine } from './error-line';
import { ChevronLeftIcon, PencilIcon, TrashIcon } from './icons';
import { LinkedContacts } from './linked-contacts';
import { LinkedDeals } from './linked-deals';
import { PropertiesCard } from './properties-card';

/**
 * `/companies/[id]` (TW-CTP-005): Reference's company 360. Name and contact line, the three rollup tiles, the company's contacts and
 * deals side by side, and the notes; here also an edit form, adding and removing contacts, the details Reference stored but never
 * showed, and the activity trail. Reference's "Generate brief" button is not here: the client brief is another feature, not built.
 */
export function CompanyDetail({ id }: { id: string }) {
  const t = useTranslations('companies.detail');
  const tList = useTranslations('companies.list');
  const tToast = useTranslations('companies.toast');
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canUpdate = useCan('record.companies.update');
  const canDelete = useCan('record.companies.delete');
  const canReadContacts = useCan('record.contacts.read');
  const canUpdateContacts = useCan('record.contacts.update');
  const canReadDeals = useCan('record.deals.read');
  const company = useCompany(id);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = useMutation({
    mutationFn: () => companiesApi.remove(id),
    onSuccess: async () => {
      await invalidateCompanies(qc);
      toast(tToast('deleted', { count: 1 }), 'success');
      router.replace('/companies');
    },
    onError: () => {
      setDeleting(false);
      toast(tToast('deleteFailed'), 'danger');
    },
  });

  const back = (
    <Link
      href="/companies"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeftIcon className="size-3.5 rtl:rotate-180" /> {t('back')}
    </Link>
  );

  if (company.isPending) {
    return (
      <section>
        {back}
        <div role="status" className="flex items-center gap-2 py-10 text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      </section>
    );
  }
  if (company.isError) {
    const kind = errorKind(company.error);
    return (
      <section>
        {back}
        {kind === 'notFound' ? (
          <EmptyState title={t('notFoundTitle')} message={t('notFound')} />
        ) : kind === 'unavailable' ? (
          <EmptyState title={tList('unavailableTitle')} message={tList('unavailable')} />
        ) : (
          <ErrorLine error={company.error} onRetry={() => void company.refetch()} />
        )}
      </section>
    );
  }

  const c = company.data;
  const href = websiteHref(c.website);
  const rollup = c.rollup;
  const won = formatTotals(rollup.deals?.wonValue, locale);
  const num = (n: number | null | undefined) =>
    n === null || n === undefined ? '—' : new Intl.NumberFormat(locale).format(n);

  return (
    <section>
      {back}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold leading-tight" dir="auto">
            {c.name}
          </h1>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {c.industry && <span dir="auto">{c.industry}</span>}
            {c.website &&
              (href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  dir="ltr"
                  className="text-brand underline-offset-2 hover:underline dark:text-primary"
                >
                  {c.website}
                </a>
              ) : (
                <span dir="ltr">{c.website}</span>
              ))}
            {c.email && <span dir="ltr">{c.email}</span>}
            {c.phone && <span dir="ltr">{c.phone}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {canUpdate && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <PencilIcon /> {t('edit')}
            </Button>
          )}
          {canDelete && (
            <Button
              variant="secondary"
              className="border-danger text-danger hover:bg-danger/10"
              onClick={() => setDeleting(true)}
            >
              <TrashIcon /> {t('delete')}
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
        <StatTile label={t('tiles.contacts')} value={num(rollup.contacts)} />
        <StatTile label={t('tiles.openDeals')} value={num(rollup.deals?.open)} />
        <StatTile
          label={t('tiles.wonRevenue')}
          value={
            rollup.deals === null ? (
              '—'
            ) : won.length === 0 ? (
              <span className="text-muted-foreground">{'—'}</span>
            ) : (
              <span className="block space-y-0.5 text-xl leading-tight">
                {won.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </span>
            )
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <div className="grid gap-6 xl:grid-cols-2">
            {canReadContacts && (
              <LinkedContacts companyId={id} canLink={canUpdate && canUpdateContacts} />
            )}
            {canReadDeals && <LinkedDeals companyId={id} />}
          </div>
          <LinkedTasks kind="company" id={id} label={c.name} />
          <PropertiesCard company={c} />
          {c.notes && (
            <section
              aria-labelledby="company-notes"
              className="rounded-md border border-border bg-background p-4"
            >
              <h2
                id="company-notes"
                className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
              >
                {t('notes')}
              </h2>
              <p className="whitespace-pre-line break-words text-sm" dir="auto">
                {c.notes}
              </p>
            </section>
          )}
          <ActivityCard companyId={id} />
        </div>
        <Aside company={c} />
      </div>

      {editing && <CompanyFormModal company={c} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={deleting}
        tone="danger"
        busy={remove.isPending}
        title={t('deleteTitle')}
        message={t('deleteMessage')}
        confirmLabel={t('delete')}
        cancelLabel={t('keep')}
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
      />
    </section>
  );
}

function Aside({ company: c }: { company: NonNullable<ReturnType<typeof useCompany>['data']> }) {
  const t = useTranslations('companies.detail');
  const format = useFormatter();
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  return (
    <aside className="h-max space-y-4 rounded-md border border-border bg-background p-4">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {t('details')}
      </h2>
      <dl className="space-y-3 text-sm">
        <Detail label={t('owner')}>{c.owner?.name}</Detail>
        <Detail label={t('sizeRange')}>{c.sizeRange}</Detail>
        <Detail label={t('address')}>
          {c.address && <span className="whitespace-pre-line">{c.address}</span>}
        </Detail>
        <Detail label={t('createdBy')}>{c.createdBy?.name}</Detail>
        <Detail label={t('created')}>{date(c.createdAt)}</Detail>
        <Detail label={t('updated')}>{date(c.updatedAt)}</Detail>
      </dl>
    </aside>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === '' || children === false || children == null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words" dir="auto">
        {empty ? <span className="text-muted-foreground">&mdash;</span> : children}
      </dd>
    </div>
  );
}
