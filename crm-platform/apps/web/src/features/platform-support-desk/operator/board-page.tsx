'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BOARD_COLUMNS,
  suppBoardResponseSchema,
  type BoardCard,
  type BoardColumn,
} from '@crm/contracts';
import { Badge, Button, Select, cn } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { INBOX_KEY, PRIORITY_TONE, STATUS_TONE, errorKey } from '../lib/display';
import { relativeTime } from '../lib/format';
import { useLocale } from 'next-intl';

const NS = 'platform-support-desk';
const BOARD_KEY = ['support', 'operator', 'board'] as const;

/** Team-inbox kanban (WD-SUPP-015, 016): four columns, drag a card to change its status. */
export function BoardPage() {
  const t = useTranslations(`${NS}.board`);
  const te = useTranslations(`${NS}.errors`);
  const tp = useTranslations(`${NS}.priority`);
  const locale = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const { operator } = useOperator();
  const canWrite = operator.role !== 'auditor';
  const [mine, setMine] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<BoardColumn | null>(null);

  const q = useQuery({
    queryKey: [...BOARD_KEY, mine],
    queryFn: ({ signal }) =>
      operatorFetch('/support/board', {
        query: { mine: mine ? 1 : 0 },
        schema: suppBoardResponseSchema,
        signal,
      }),
  });

  const move = useMutation({
    mutationFn: (v: { card: BoardCard; status: BoardColumn }) =>
      operatorFetch(`/support/board/${v.card.id}/move`, {
        method: 'POST',
        body: { status: v.status, rowVersion: v.card.rowVersion },
      }),
    onSuccess: () => {
      toast.success(t('moved'));
      void qc.invalidateQueries({ queryKey: BOARD_KEY });
      void qc.invalidateQueries({ queryKey: INBOX_KEY });
    },
    onError: (e) => {
      toast.error(te(errorKey(e)));
      void qc.invalidateQueries({ queryKey: BOARD_KEY });
    },
  });

  const find = (id: string): BoardCard | undefined =>
    q.data && BOARD_COLUMNS.flatMap((c) => q.data!.columns[c]).find((x) => x.id === id);
  const drop = (status: BoardColumn) => {
    const card = dragging ? find(dragging) : undefined;
    setDragging(null);
    setOver(null);
    if (card && card.status !== status && canWrite) move.mutate({ card, status });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button variant="secondary" onClick={() => setMine(!mine)}>
            {mine ? t('all') : t('mine')}
          </Button>
        }
      />
      {q.isPending && <LoadingBlock />}
      {q.isError && <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BOARD_COLUMNS.map((col) => {
            const cards = q.data.columns[col];
            return (
              <div
                key={col}
                data-testid={`column-${col}`}
                onDragOver={(e) => {
                  if (canWrite) {
                    e.preventDefault();
                    setOver(col);
                  }
                }}
                onDragLeave={() => setOver((o) => (o === col ? null : o))}
                onDrop={() => drop(col)}
                className={cn(
                  'flex min-h-[400px] flex-col rounded-lg border bg-background',
                  over === col && 'border-primary ring-1 ring-primary',
                )}
              >
                <div className="flex items-center gap-2 border-b px-4 py-3">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    {t(`columns.${col}`)}
                  </span>
                  <Badge tone={STATUS_TONE[col]}>{cards.length}</Badge>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                  {cards.length === 0 && (
                    <p className="py-6 text-center text-xs text-muted-foreground">{t('none')}</p>
                  )}
                  {cards.map((c) => (
                    <article
                      key={c.id}
                      draggable={canWrite}
                      onDragStart={() => setDragging(c.id)}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      className={cn(
                        'rounded-md border bg-muted/30 p-3 hover:border-primary',
                        canWrite && 'cursor-grab',
                        dragging === c.id && 'opacity-50',
                      )}
                      data-testid="board-card"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{c.subject}</p>
                          <p className="truncate font-mono text-[11px] text-muted-foreground">
                            {c.ticketNumber} · {relativeTime(c.createdAt, locale)}
                          </p>
                        </div>
                        <Badge tone={PRIORITY_TONE[c.priority]}>{tp(c.priority)}</Badge>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{c.excerpt}</p>
                      <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                        {c.customer}
                      </p>
                      {canWrite && (
                        <Select
                          aria-label={t('moveTo', { column: '' })}
                          className="mt-2 h-8 text-xs"
                          value={c.status}
                          disabled={move.isPending}
                          onChange={(e) =>
                            move.mutate({ card: c, status: e.target.value as BoardColumn })
                          }
                        >
                          {BOARD_COLUMNS.map((b) => (
                            <option key={b} value={b}>
                              {t('moveTo', { column: t(`columns.${b}`) })}
                            </option>
                          ))}
                        </Select>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}
      <p className="text-xs text-muted-foreground">{t('keyboardHint')}</p>
    </div>
  );
}
