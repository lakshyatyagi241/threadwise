'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { waFormPickerListSchema } from '@crm/contracts';
import { Field, Select } from '@crm/ui';
import { apiFetch } from '@/lib/api/client';
import type { ButtonRow } from '../lib/buttons';

/**
 * The Form button's WhatsApp Flow: chosen from the workspace's published WhatsApp Forms, not typed as an id. Choosing one fills the Flow
 * id and the screen it opens on. A Flow the template already points at that is not among them (one made in Meta) stays listed by its id.
 */
export function FlowPick({
  row,
  id,
  error,
  onPick,
}: {
  row: ButtonRow;
  id: string;
  error?: string | undefined;
  onPick: (pick: { flowId: string; screen: string }) => void;
}) {
  const t = useTranslations('message-templates.form.buttons');
  const forms = useQuery({
    queryKey: ['tpl', 'wa-forms-picker'] as const,
    queryFn: ({ signal }) =>
      apiFetch('/wa-forms/picker', { schema: waFormPickerListSchema, signal }),
    staleTime: 30_000,
  });
  // Meta's id of a Flow is a number. A form marked published whose id is not one (a seeded or imported record) was never made at Meta,
  // so a template cannot point at it: it is listed, greyed out, with the reason.
  const live = (forms.data?.forms ?? []).filter((f) => f.isPublished && f.metaFlowId);
  const published = live.filter((f) => /^\d+$/.test(f.metaFlowId ?? ''));
  const notOnMeta = live.filter((f) => !/^\d+$/.test(f.metaFlowId ?? ''));
  const known = published.some((f) => f.metaFlowId === row.flowId);
  return (
    <Field
      label={t('flowPick')}
      htmlFor={id}
      hint={
        !forms.isPending && published.length === 0 && !row.flowId ? (
          <>
            {t('flowNone')}{' '}
            <Link href="/wa-forms" className="underline">
              {t('flowNoneLink')}
            </Link>
          </>
        ) : (
          t('flowPickHint')
        )
      }
      error={error}
    >
      <Select
        id={id}
        value={row.flowId}
        onChange={(e) => {
          const f = published.find((x) => x.metaFlowId === e.target.value);
          if (f) onPick({ flowId: f.metaFlowId ?? '', screen: f.firstScreenId });
        }}
      >
        <option value="">{forms.isPending ? t('flowLoading') : t('flowChoose')}</option>
        {published.map((f) => (
          <option key={f.id} value={f.metaFlowId ?? ''}>
            {f.title}
          </option>
        ))}
        {notOnMeta.map((f) => (
          <option key={f.id} value={`x:${f.id}`} disabled>
            {t('flowNotOnMeta', { title: f.title })}
          </option>
        ))}
        {row.flowId && !known && (
          <option value={row.flowId}>{t('flowById', { id: row.flowId })}</option>
        )}
      </Select>
    </Field>
  );
}
