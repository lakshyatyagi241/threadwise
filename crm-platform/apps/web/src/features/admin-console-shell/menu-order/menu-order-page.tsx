'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { navLayoutResponseSchema, navMoreZone, type NavLayoutKey } from '@crm/contracts';
import { Alert, Button, Card, Spinner } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { addToBar, moveInBar, removeFromBar } from './menu-order-state';

const NS = 'admin-console-shell.menuOrder';
const KEY = ['operator', 'shell', 'nav-layout'] as const;
const ROW = 'flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5';

/** TW-ASHELL-009: choose which entries sit in the customer top bar and in what order. */
export function MenuOrderPage() {
  const t = useTranslations(NS);
  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/shell/nav-layout', { schema: navLayoutResponseSchema, signal }),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="danger">{t('loadFailed')}</Alert>;
  return <Editor initial={q.data.bar} />;
}

function Editor({ initial }: { initial: NavLayoutKey[] }) {
  const t = useTranslations(NS);
  const canEdit = useOperator().canRunDanger;
  const qc = useQueryClient();
  const [bar, setBar] = useState<NavLayoutKey[]>(initial);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (body: { bar: NavLayoutKey[] } | null) =>
      operatorFetch(body ? '/shell/nav-layout' : '/shell/nav-layout/reset', {
        method: body ? 'PUT' : 'POST',
        body: body ?? undefined,
        schema: navLayoutResponseSchema,
      }),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      setBar(data.bar);
      setSaved(true);
    },
  });

  const more = navMoreZone(bar);
  const label = (k: NavLayoutKey) => t(`items.${k}`);
  const edit = (next: NavLayoutKey[]) => {
    setSaved(false);
    setBar(next);
  };

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('note')}</p>
      </header>
      {saved && <Alert tone="success">{t('saved')}</Alert>}
      {save.isError && <Alert tone="danger">{t('saveFailed')}</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">{t('barZone')}</h2>
          <ol className="space-y-1" aria-label={t('barZone')}>
            {bar.map((k, i) => (
              <li key={k} className={ROW}>
                <span>{label(k)}</span>
                {k === 'more' ? (
                  <span className="text-xs text-muted-foreground">{t('locked')}</span>
                ) : (
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canEdit || i === 0}
                      aria-label={t('moveUp', { item: label(k) })}
                      onClick={() => edit(moveInBar(bar, k, -1))}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canEdit}
                      aria-label={t('moveDown', { item: label(k) })}
                      onClick={() => edit(moveInBar(bar, k, 1))}
                    >
                      ↓
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canEdit}
                      aria-label={t('remove', { item: label(k) })}
                      onClick={() => edit(removeFromBar(bar, k))}
                    >
                      {t('removeShort')}
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        </Card>
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">{t('moreZone')}</h2>
          <ul className="space-y-1">
            {more.map((k) => (
              <li key={k} className={ROW}>
                <span>{label(k)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canEdit}
                  aria-label={t('add', { item: label(k) })}
                  onClick={() => edit(addToBar(bar, k))}
                >
                  {t('addShort')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {canEdit && (
        <div className="flex gap-2">
          <Button onClick={() => save.mutate({ bar })} disabled={save.isPending}>
            {t('save')}
          </Button>
          <Button variant="secondary" onClick={() => save.mutate(null)} disabled={save.isPending}>
            {t('reset')}
          </Button>
        </div>
      )}
    </section>
  );
}
