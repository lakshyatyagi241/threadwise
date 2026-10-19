'use client';

import { useId, useState } from 'react';
import { Alert, Badge, Button, Input, Spinner } from '@crm/ui';
import type { AssignmentSubject, TestAssignmentResponse } from '@crm/contracts';
import { assignmentApi, useRecordSearch, type RecordHit } from '../api/assignment';
import { outcomeTone, traceStatuses } from '../lib/outcome';
import { useDebounced } from '../lib/use-debounced';
import { useRa } from './use-ra';

/** The readable list of rules a record was tried against, in order, with what happened to each. */
export function TraceList({
  trace,
  assigned,
  title,
}: {
  trace: TestAssignmentResponse['trace'];
  assigned: boolean;
  title: string;
}) {
  const { t } = useRa();
  const statuses = traceStatuses(trace, assigned);
  if (trace.length === 0)
    return <p className="text-xs text-muted-foreground">{t('test.traceEmpty')}</p>;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">{title}</p>
      <ol className="space-y-1" data-testid="ra-trace">
        {trace.map((e, i) => {
          const status = statuses[i]!;
          return (
            <li
              key={`${e.ruleId}-${i}`}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm"
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {e.name}
              </span>
              <Badge
                tone={
                  status === 'winner'
                    ? 'success'
                    : status === 'nobody' || status === 'broken'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {t(`test.trace.${status}`)}
              </Badge>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * "Test with a record": pick a real contact, company or deal and see which rule would take it and who would get it, with every rule that
 * was tried. Nothing is changed, and it works while the workspace switch is off. It tests the rules as they are SAVED.
 */
export function TestBox({ subject }: { subject: AssignmentSubject }) {
  const { t } = useRa();
  const inputId = useId();
  const listId = useId();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<RecordHit | null>(null);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<TestAssignmentResponse | null>(null);
  const term = useDebounced(text, 250);
  const hits = useRecordSearch(subject, term, open && picked === null);

  const run = async () => {
    if (!picked) return;
    setRunning(true);
    setFailed(false);
    try {
      setResult(await assignmentApi.test({ subject, recordId: picked.id }));
    } catch {
      setResult(null);
      setFailed(true);
    } finally {
      setRunning(false);
    }
  };

  const label = result?.record?.label ?? picked?.label ?? '';
  const message = result
    ? t(`test.outcome.${result.outcome}`, {
        record: label,
        owner: result.owner?.name ?? '',
        rule: result.rule?.name ?? '',
      })
    : '';

  return (
    <section
      className="space-y-3 rounded-lg border border-border p-4"
      aria-labelledby={`${inputId}-title`}
      data-testid="ra-test"
    >
      <div>
        <h3 id={`${inputId}-title`} className="text-sm font-semibold">
          {t('test.title')}
        </h3>
        <p className="text-xs text-muted-foreground">{t('test.hint')}</p>
      </div>

      {picked ? (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
            dir="auto"
          >
            {picked.label}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setPicked(null);
              setResult(null);
              setText('');
            }}
          >
            {t('test.clear')}
          </Button>
        </div>
      ) : (
        <div className="relative max-w-md">
          <label htmlFor={inputId} className="sr-only">
            {t('test.searchLabel')}
          </label>
          <Input
            id={inputId}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            value={text}
            placeholder={t(`test.search.${subject}`)}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          {open && (
            <ul
              id={listId}
              role="listbox"
              aria-label={t('test.searchLabel')}
              className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg"
            >
              {hits.isFetching && (
                <li className="px-2.5 py-2 text-xs text-muted-foreground">{t('test.searching')}</li>
              )}
              {hits.isError && (
                <li className="px-2.5 py-2 text-xs text-danger">{t('test.searchFailed')}</li>
              )}
              {hits.data?.length === 0 && !hits.isFetching && (
                <li className="px-2.5 py-2 text-xs text-muted-foreground">{t('test.noMatches')}</li>
              )}
              {(hits.data ?? []).map((h) => (
                <li key={h.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    className="w-full rounded px-2.5 py-2 text-start text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    dir="auto"
                    onClick={() => {
                      setPicked(h);
                      setOpen(false);
                      setResult(null);
                    }}
                  >
                    {h.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Button disabled={!picked || running} onClick={() => void run()}>
        {running && <Spinner />}
        {running ? t('test.running') : t('test.run')}
      </Button>

      <div aria-live="polite" className="space-y-3">
        {failed && <Alert tone="danger">{t('test.failed')}</Alert>}
        {result && (
          <div className="space-y-3" data-testid="ra-test-result">
            <Alert tone={outcomeTone(result.outcome)}>
              <p>{message}</p>
              {!result.enabled && result.outcome !== 'disabled' && (
                <p className="mt-1 text-xs">{t('test.off')}</p>
              )}
              {result.skipped.length > 0 && (
                <p className="mt-1 text-xs">
                  {t('test.skipped', { names: result.skipped.map((s) => s.name).join(', ') })}
                </p>
              )}
            </Alert>
            <TraceList
              trace={result.trace}
              assigned={result.outcome === 'would_assign'}
              title={t('test.traceTitle')}
            />
          </div>
        )}
      </div>
    </section>
  );
}
