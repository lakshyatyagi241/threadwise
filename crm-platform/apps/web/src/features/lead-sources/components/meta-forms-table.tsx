'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { MetaLeadForm } from '@crm/contracts';
import { Badge, Button, Spinner } from '@crm/ui';
import { formStatusKey } from '../lib/meta-view';
import { sourceHref } from '../lib/source-view';
import { When } from './ui';

export interface FormActions {
  onPick: (form: MetaLeadForm) => void;
  onStop: (form: MetaLeadForm) => void;
  onMap: (form: MetaLeadForm) => void;
  onRules: (form: MetaLeadForm) => void;
}

const LINK =
  'inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * The lead forms of one Page. The table scrolls inside its own wrapper so the page never scrolls sideways on a phone. A form that
 * is not picked offers Pick; a picked one offers Map fields, Assignment and deal, Open source and Stop.
 */
export function MetaFormsTable({
  forms,
  busy,
  pickingId,
  actions,
}: {
  forms: readonly MetaLeadForm[];
  /** Any form call is in flight: every row button waits. */
  busy: boolean;
  pickingId: string | null;
  actions: FormActions;
}) {
  const t = useTranslations('lead-sources.meta.forms');
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[60rem] border-collapse text-sm">
        <caption className="sr-only">{t('caption')}</caption>
        <thead>
          <tr className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
            {(
              [
                'form',
                'status',
                'leads',
                'questions',
                'consent',
                'connected',
                'lastLead',
                'lastError',
                'actions',
              ] as const
            ).map((col) => (
              <th key={col} scope="col" className="px-3 py-2 text-start font-semibold">
                {t(`col.${col}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {forms.map((f) => (
            <FormRow
              key={f.formId}
              form={f}
              busy={busy}
              picking={pickingId === f.formId}
              actions={actions}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormRow({
  form: f,
  busy,
  picking,
  actions,
}: {
  form: MetaLeadForm;
  busy: boolean;
  picking: boolean;
  actions: FormActions;
}) {
  const t = useTranslations('lead-sources.meta.forms');
  return (
    <tr
      data-testid="meta-form-row"
      data-form={f.formId}
      data-connected={f.connected}
      className="align-top"
    >
      <td className="max-w-[16rem] px-3 py-3">
        <div className="break-words font-medium" dir="auto">
          {f.name}
        </div>
        <div className="text-xs text-muted-foreground">
          {t('formId')} <code dir="ltr">{f.formId}</code>
        </div>
      </td>
      <td className="px-3 py-3 text-xs">{t(`formStatus.${formStatusKey(f.status)}`)}</td>
      <td className="px-3 py-3 text-xs">
        {f.leadsCount === null ? <span aria-label={t('leadsUnknown')}>-</span> : f.leadsCount}
      </td>
      <td className="px-3 py-3 text-xs">{f.questions.length}</td>
      <td className="px-3 py-3 text-xs">
        {f.hasConsentCheckbox ? (
          <Badge tone="success">{t('consentYes')}</Badge>
        ) : (
          <span className="text-muted-foreground">{t('consentNo')}</span>
        )}
      </td>
      <td className="px-3 py-3">
        {f.connected ? (
          <Badge tone="success">{t('connected')}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">{t('notConnected')}</span>
        )}
      </td>
      <td className="px-3 py-3 text-xs">
        {f.connected ? <When value={f.lastLeadAt} empty={t('noLeads')} /> : '-'}
      </td>
      <td className="max-w-[14rem] px-3 py-3 text-xs">
        {f.lastError ? (
          <span className="break-words text-danger" dir="auto">
            {f.lastError}
          </span>
        ) : (
          '-'
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-2">
          {f.connected ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !f.sourceId}
                aria-label={t('mapFieldsFor', { name: f.name })}
                onClick={() => actions.onMap(f)}
              >
                {t('mapFields')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !f.sourceId}
                aria-label={t('rulesFor', { name: f.name })}
                onClick={() => actions.onRules(f)}
              >
                {t('rules')}
              </Button>
              {f.sourceId && (
                <Link
                  href={sourceHref(f.sourceId)}
                  className={LINK}
                  aria-label={t('openSourceFor', { name: f.name })}
                >
                  {t('openSource')}
                </Link>
              )}
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                aria-label={t('stopFor', { name: f.name })}
                onClick={() => actions.onStop(f)}
              >
                {t('stop')}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={busy}
              aria-label={t('pickFor', { name: f.name })}
              onClick={() => actions.onPick(f)}
            >
              {picking && <Spinner />}
              {t('pick')}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
