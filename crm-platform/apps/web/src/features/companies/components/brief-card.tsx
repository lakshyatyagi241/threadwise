'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import {
  BRIEF_SECTION_KEYS,
  briefToText,
  type BriefSectionKey,
  type CompanyBrief,
} from '@crm/contracts';
import { Alert, Button, Spinner, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import type { useCompanyBrief } from '../api/brief';
import { briefErrorKind, SOURCE_KEYS } from '../lib/brief';
import { ErrorLine } from './error-line';
import { CopyIcon, RefreshIcon, SparklesIcon } from './icons';

type BriefHook = ReturnType<typeof useCompanyBrief>;

/**
 * "Account brief" on the company page (BL-194): an AI-written summary of the company (who they are, deals, tasks, conversations, key
 * properties, risks and next steps) from the CRM data the person can already see. Reference's button built a shareable deck with a
 * public link; here the brief is private to the person who asked and shown on the page, with Copy and Regenerate. The card says what
 * is and is not sent to the model, and says plainly when no AI key is set up.
 */
export function BriefCard({ name, brief }: { name: string; brief: BriefHook }) {
  const t = useTranslations('companies.brief');
  const state = brief.state;
  const generate = brief.generate;
  const canKeys = useCan('aiadm.keys.read');

  const data = state.data;
  const current = data?.brief ?? null;
  const unavailable = data ? !data.available : false;
  const failure = generate.isError ? briefErrorKind(generate.error) : null;

  return (
    <section
      aria-labelledby="company-brief"
      className="rounded-md border border-border bg-background p-4"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="company-brief"
            className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            <SparklesIcon /> {t('title')}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
        {current && (
          <div className="flex shrink-0 gap-2">
            <CopyButton name={name} brief={current} />
            <Button
              variant="secondary"
              size="sm"
              disabled={generate.isPending || unavailable}
              onClick={() => generate.mutate(true)}
            >
              {generate.isPending ? <Spinner /> : <RefreshIcon />} {t('regenerate')}
            </Button>
          </div>
        )}
      </div>

      {state.isPending ? (
        <div role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : state.isError ? (
        <ErrorLine error={state.error} onRetry={() => void state.refetch()} />
      ) : (
        <>
          {unavailable && !current && (
            <Alert tone="warning" className="mb-3">
              <p className="font-medium">{t('unavailableTitle')}</p>
              <p className="mt-1 text-sm">{t('unavailable')}</p>
              <p className="mt-1 text-sm">
                {canKeys ? (
                  <Link href="/ai-keys" className="underline underline-offset-2">
                    {t('addKey')}
                  </Link>
                ) : (
                  t('askAdmin')
                )}
              </p>
            </Alert>
          )}

          {failure && failure !== 'unavailable' && (
            <Alert tone={failure === 'tooSoon' ? 'info' : 'danger'} className="mb-3">
              <span role="alert">{t(`errors.${failure}`)}</span>
            </Alert>
          )}
          {failure === 'unavailable' && (
            <Alert tone="warning" className="mb-3">
              <span role="alert">{t('unavailable')}</span>
            </Alert>
          )}

          {current ? (
            <BriefBody brief={current} />
          ) : (
            !unavailable && (
              <div className="py-2">
                <p className="mb-3 text-sm text-muted-foreground">{t('empty')}</p>
                <Button
                  variant="brand"
                  disabled={generate.isPending}
                  onClick={() => generate.mutate(false)}
                >
                  {generate.isPending ? <Spinner /> : <SparklesIcon />} {t('generate')}
                </Button>
              </div>
            )
          )}

          <Notice sources={data?.sources} />
        </>
      )}
    </section>
  );
}

function BriefBody({ brief }: { brief: CompanyBrief }) {
  const t = useTranslations('companies.brief');
  const ts = useTranslations('companies.brief.sections');
  const format = useFormatter();
  return (
    <div className="space-y-4 text-sm">
      {brief.stale && (
        <Alert tone="info">
          <span>{t('stale')}</span>
        </Alert>
      )}
      <p className="whitespace-pre-line break-words" dir="auto">
        {brief.content.summary}
      </p>
      {BRIEF_SECTION_KEYS.map((key) => {
        const section = brief.content.sections.find((s) => s.key === key);
        if (!section || section.bullets.length === 0) return null;
        return (
          <div key={key}>
            <h3 className="mb-1 font-semibold">{ts(key)}</h3>
            <ul className="list-disc space-y-1 ps-5">
              {section.bullets.map((b, i) => (
                <li key={`${key}-${i}`} className="break-words" dir="auto">
                  {b}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        {t('writtenBy', {
          date: format.dateTime(new Date(brief.generatedAt), {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
          model: brief.model,
        })}
      </p>
    </div>
  );
}

function CopyButton({ name, brief }: { name: string; brief: CompanyBrief }) {
  const t = useTranslations('companies.brief');
  const ts = useTranslations('companies.brief.sections');
  const { toast } = useToast();
  const copy = async () => {
    const labels = Object.fromEntries(BRIEF_SECTION_KEYS.map((k) => [k, ts(k)])) as Record<
      BriefSectionKey,
      string
    >;
    try {
      await navigator.clipboard.writeText(
        briefToText(brief.content, t('copyTitle', { name }), labels),
      );
      toast(t('copied'), 'success');
    } catch {
      toast(t('copyFailed'), 'danger');
    }
  };
  return (
    <Button variant="secondary" size="sm" onClick={() => void copy()}>
      <CopyIcon /> {t('copy')}
    </Button>
  );
}

/** What goes to the model and what does not, and which kinds of records this brief was written from. */
function Notice({ sources }: { sources: Record<string, boolean> | undefined }) {
  const t = useTranslations('companies.brief');
  const ts = useTranslations('companies.brief.source');
  const used = SOURCE_KEYS.filter((k) => sources?.[k]);
  return (
    <div className="mt-4 space-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
      <p>{t('notice')}</p>
      <p>
        {used.length > 0
          ? t('basedOn', { kinds: used.map((k) => ts(k)).join(', ') })
          : t('basedOnNone')}
      </p>
    </div>
  );
}
