'use client';

import { useTranslations } from 'next-intl';
import { Button, Spinner, StatTile, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useCampaignReport, useStampResponses } from '../api/hooks';
import { errorKey } from '../lib/errors';
import {
  LoadError,
  Nothing,
  SectionCard,
  SkeletonRows,
  useFormatDate,
  useFormatNumber,
} from './parts';

/**
 * What each campaign really got: the contacts who wrote back within 24 and 72 hours of the send, counted from the inbox (the
 * campaign's own response counter is rarely filled in by anything else).
 */
export function CampaignsTab() {
  const t = useTranslations('growth.campaigns');
  const { toast } = useToast();
  const fmt = useFormatDate();
  const num = useFormatNumber();
  const canRun = useCan('lsc.contacts.score');
  const q = useCampaignReport(true);
  const stamp = useStampResponses();

  return (
    <SectionCard
      id="growth-campaigns"
      title={t('title')}
      hint={t('hint')}
      aside={
        canRun && (
          <Button
            size="sm"
            variant="secondary"
            disabled={stamp.isPending}
            onClick={() =>
              stamp.mutate(undefined, {
                onSuccess: (r) => toast(t('stamped', { count: r.stamped }), 'success'),
                onError: () => toast(t('stampFailed'), 'danger'),
              })
            }
          >
            {stamp.isPending && <Spinner />}
            {t('stamp')}
          </Button>
        )
      }
    >
      {q.isPending && <SkeletonRows rows={4} />}
      {q.isError && (
        <LoadError errorKey={errorKey(q.error)} error={q.error} onRetry={() => void q.refetch()} />
      )}
      {q.isSuccess && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <StatTile label={t('totals.sent')} value={num.count(q.data.totals.sent)} />
            <StatTile label={t('totals.read')} value={num.count(q.data.totals.read)} />
            <StatTile
              label={t('totals.replied24h')}
              value={num.count(q.data.totals.replied24h)}
              tone="accent"
            />
            <StatTile label={t('totals.replied72h')} value={num.count(q.data.totals.replied72h)} />
          </div>
          {q.data.data.length === 0 ? (
            <Nothing>{t('empty')}</Nothing>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-start text-xs text-muted-foreground">
                    <th className="py-2 pe-3 text-start font-medium">{t('cols.campaign')}</th>
                    <th className="px-3 py-2 text-end font-medium">{t('cols.sent')}</th>
                    <th className="px-3 py-2 text-end font-medium">{t('cols.read')}</th>
                    <th className="px-3 py-2 text-end font-medium">{t('cols.replied24h')}</th>
                    <th className="px-3 py-2 text-end font-medium">{t('cols.replied72h')}</th>
                    <th className="ps-3 py-2 text-end font-medium">{t('cols.replyRate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.data.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="py-2 pe-3">
                        <p className="font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[c.templateName, c.sentAt ? fmt(c.sentAt) : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-end">{num.count(c.sent)}</td>
                      <td className="px-3 py-2 text-end">{num.count(c.read)}</td>
                      <td className="px-3 py-2 text-end">{num.count(c.replied24h)}</td>
                      <td className="px-3 py-2 text-end">{num.count(c.replied72h)}</td>
                      <td className="ps-3 py-2 text-end">{num.percent(c.replyRate24h)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
