'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { cn } from '@crm/ui';
import type { EndpointView, HttpMethod, ResponseView } from '../lib/spec-model';
import { CodeBlock } from './docs-parts';

const VERB_PILL: Record<HttpMethod, string> = {
  get: 'bg-primary text-primary-foreground',
  post: 'bg-success text-background',
  put: 'bg-warning text-background',
  patch: 'bg-warning text-background',
  delete: 'bg-danger text-danger-foreground',
};
const SEC_LABEL =
  'mb-2 mt-5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground';
const TH =
  'px-2.5 py-1.5 text-start font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground';

export const verbText: Record<HttpMethod, string> = {
  get: 'text-primary',
  post: 'text-success',
  put: 'text-warning',
  patch: 'text-warning',
  delete: 'text-danger',
};

export function MethodPill({ method }: { method: HttpMethod }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-md px-2 py-1 font-mono text-[11px] font-bold uppercase tracking-wide',
        VERB_PILL[method],
      )}
    >
      {method}
    </span>
  );
}

const codeClass = (code: string) =>
  code.startsWith('2') ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger';

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

function Table({
  head,
  rows,
}: {
  head: string;
  rows: Array<{ name: string; type: string; required: boolean; description: string }>;
}) {
  const t = useTranslations('developer-rest-api-v1-docs.reference');
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={TH}>
              {head}
            </th>
            <th scope="col" className={TH}>
              {t('description')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-border/60 align-top">
              <td className="px-2.5 py-2">
                <span className="font-mono font-semibold">{r.name}</span>{' '}
                {r.required && (
                  <span className="font-mono text-[10px] text-danger">{t('required')}</span>
                )}
                <div dir="ltr" className="font-mono text-[11.5px] text-primary rtl:text-right">
                  {r.type}
                </div>
              </td>
              <td className="px-2.5 py-2 text-muted-foreground">{r.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Response({ r }: { r: ResponseView }) {
  const t = useTranslations('developer-rest-api-v1-docs.reference');
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2.5 py-1.5 text-[12.5px]">
        <span
          className={cn('rounded-md px-2 py-0.5 font-mono text-xs font-bold', codeClass(r.code))}
        >
          {r.code}
        </span>
        <span className="text-muted-foreground">{r.description}</span>
      </div>
      {r.hasExample ? (
        <CodeBlock text={pretty(r.example)} copyLabel={t('copyJson')} />
      ) : (
        <p className="text-xs text-muted-foreground">{t('noExample')}</p>
      )}
    </div>
  );
}

/**
 * One endpoint (WD-API-149): the head is a button that opens the details: description, parameters, body fields, the generated cURL, the
 * example body and the responses. A `#op-...` address in the URL (from the sidebar or a shared link) opens its card.
 */
export function EndpointCard({ e }: { e: EndpointView }) {
  const t = useTranslations('developer-rest-api-v1-docs.reference');
  const [open, setOpen] = useState(false);
  const bodyId = `${e.id}-body`;

  useEffect(() => {
    const sync = () => {
      if (window.location.hash === `#${e.id}`) setOpen(true);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [e.id]);

  return (
    <article
      id={e.id}
      data-endpoint
      className="mb-4 scroll-mt-20 overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
    >
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={t('toggle', { method: e.method.toUpperCase(), path: e.path })}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3.5 text-start transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
            open && 'border-b border-border',
          )}
        >
          <MethodPill method={e.method} />
          <span dir="ltr" className="min-w-0 break-all font-mono text-[13.5px] font-semibold">
            <span className="font-normal text-muted-foreground">{e.prefix}</span>
            {e.shortPath}
          </span>
          <span className="ms-auto text-xs text-muted-foreground">{e.summary}</span>
          <svg
            viewBox="0 0 16 16"
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform rtl:-scale-x-100',
              open && 'rotate-90 rtl:-scale-x-100',
            )}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
      </h3>
      <div id={bodyId} hidden={!open} className="px-4 pb-4">
        {e.description && (
          <p className="mb-1 mt-3.5 text-[13px] text-muted-foreground">{e.description}</p>
        )}
        {e.params.length > 0 && (
          <>
            <div className={SEC_LABEL}>{t('parameters')}</div>
            <Table
              head={t('name')}
              rows={e.params.map((p) => ({ ...p, type: `${p.place} · ${p.type}` }))}
            />
          </>
        )}
        {e.bodyFields.length > 0 && (
          <>
            <div className={SEC_LABEL}>{t('bodyParameters')}</div>
            <Table head={t('field')} rows={e.bodyFields} />
          </>
        )}
        <div className={SEC_LABEL}>{t('exampleRequest')}</div>
        <CodeBlock text={e.curl} copyLabel={t('copyCurl')} />
        {e.hasRequestExample && e.bodyType === 'application/json' && (
          <>
            <div className={SEC_LABEL}>{t('requestBody')}</div>
            <CodeBlock text={pretty(e.requestExample)} copyLabel={t('copyJson')} />
          </>
        )}
        {e.responses.length > 0 && (
          <>
            <div className={SEC_LABEL}>{t('responses')}</div>
            {e.responses.map((r) => (
              <Response key={r.code} r={r} />
            ))}
          </>
        )}
      </div>
    </article>
  );
}
