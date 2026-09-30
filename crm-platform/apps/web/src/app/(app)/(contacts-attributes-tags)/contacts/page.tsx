'use client';

import { contactResponseSchema } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button, Card, Input } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useCursorList } from '@/lib/api/use-cursor-list';

export default function ContactsPage() {
  const t = useTranslations('contacts-attributes-tags.list');
  const c = useTranslations('common');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const list = useCursorList(['contacts'], '/contacts', contactResponseSchema, {
    q: applied || undefined,
  });

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setApplied(q.trim());
        }}
        className="flex max-w-md gap-2"
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={c('search')}
        />
        <Button type="submit" variant="secondary">
          {c('search')}
        </Button>
      </form>
      {list.isError && (
        <Card role="alert" className="text-danger">
          {c('unexpected')}
          {list.error instanceof ApiError && list.error.requestId && (
            <span className="block text-xs">
              {c('requestId')}: {list.error.requestId}
            </span>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => void list.refetch()}
          >
            {c('retry')}
          </Button>
        </Card>
      )}
      {list.isPending && <p className="text-muted-foreground">{c('loading')}</p>}
      {!list.isPending && !list.isError && list.items.length === 0 && (
        <p className="text-muted-foreground">{t('empty')}</p>
      )}
      {list.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-start text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                {(['name', 'email', 'phone', 'stage'] as const).map((k) => (
                  <th key={k} className="px-3 py-2 text-start font-medium">
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.items.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2">{row.name ?? '-'}</td>
                  <td className="px-3 py-2">{row.email ?? '-'}</td>
                  <td className="px-3 py-2">{row.phone ?? '-'}</td>
                  <td className="px-3 py-2">{row.lifecycleStage ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.hasNextPage && (
        <Button
          variant="secondary"
          onClick={() => void list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
        >
          {list.isFetchingNextPage ? c('loading') : c('loadMore')}
        </Button>
      )}
    </section>
  );
}
