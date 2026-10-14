'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PrivacyErasureReport, PrivacyRequest } from '@crm/contracts';
import { Alert, Badge, Button, Field, Input, Spinner, useToast } from '@crm/ui';
import { KEYS } from '../api/hooks';
import { privacyApi } from '../api/service';
import { errorKey } from '../lib/errors';
import { downloadText, erasePhrase, groupLines, phraseMatches, proofFile } from '../lib/model';

/** What a dry run or an executed erasure does, module by module: the counts per table and the stored files. */
export function ReportTable({ report }: { report: PrivacyErasureReport }) {
  const t = useTranslations('privacy-requests');
  const groups = groupLines(report.lines);
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.holder} className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <caption className="bg-muted px-3 py-1.5 text-start text-xs font-semibold">
              {g.holder}
            </caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-1.5 text-start font-medium">
                  {t('detail.erase.colTable')}
                </th>
                <th scope="col" className="px-3 py-1.5 text-start font-medium">
                  {t('detail.erase.colWhat')}
                </th>
                <th scope="col" className="px-3 py-1.5 text-end font-medium">
                  {t('detail.erase.colCount')}
                </th>
                <th scope="col" className="px-3 py-1.5 text-start font-medium">
                  {t('detail.erase.colReason')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {g.lines.map((l) => (
                <tr key={`${l.holder}.${l.table}.${l.disposition}`}>
                  <td className="px-3 py-1.5 font-mono text-xs">{l.table}</td>
                  <td className="px-3 py-1.5">
                    <Badge
                      tone={
                        l.disposition === 'deleted'
                          ? 'danger'
                          : l.disposition === 'retained'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {t(`disposition.${l.disposition}`)}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 text-end tabular-nums">{l.count}</td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{l.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="text-sm">{t('detail.erase.files', { count: report.files })}</p>
      <p className="text-sm font-medium">
        {t('detail.erase.totals', {
          deleted: report.totals.deleted,
          anonymised: report.totals.anonymised,
          retained: report.totals.retained,
        })}
      </p>
    </div>
  );
}

/**
 * Erase: a preview (counts only, nothing changes), then a typed confirmation `ERASE <reference>` that has to match exactly before the
 * button is enabled. After the run the proof stays on the request and can be downloaded as a JSON file.
 */
export function EraseSection({ request }: { request: PrivacyRequest }) {
  const t = useTranslations('privacy-requests');
  const f = useFormatter();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');
  const [preview, setPreview] = useState<PrivacyErasureReport | null>(request.dryRun);
  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.all });

  const dry = useMutation({
    mutationFn: () => privacyApi.erase(request.id, { dryRun: true }),
    onSuccess: async (report) => {
      setPreview(report);
      setTyped('');
      await refresh();
    },
  });
  const run = useMutation({
    mutationFn: () => privacyApi.erase(request.id, { dryRun: false, confirmation: typed.trim() }),
    onSuccess: async () => {
      toast(t('detail.erase.done'), 'success');
      setTyped('');
      await refresh();
    },
  });
  const error = run.error ?? dry.error;
  const proof = request.proof;
  const matches = phraseMatches(typed, request.reference);

  return (
    <section className="space-y-3 rounded-xl border border-border bg-background p-4">
      <h2 className="text-sm font-semibold">{t('detail.erase.title')}</h2>

      {proof ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">{t('detail.proof.title')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('detail.proof.executedAt', {
              date: f.dateTime(new Date(proof.executedAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
            {proof.executedBy
              ? ` - ${t('detail.proof.executedBy', { actor: proof.executedBy })}`
              : ''}
          </p>
          <p className="text-sm">
            {t('detail.proof.totals', {
              deleted: proof.lines
                .filter((l) => l.disposition === 'deleted')
                .reduce((n, l) => n + l.count, 0),
              anonymised: proof.lines
                .filter((l) => l.disposition === 'anonymised')
                .reduce((n, l) => n + l.count, 0),
              retained: proof.lines
                .filter((l) => l.disposition === 'retained')
                .reduce((n, l) => n + l.count, 0),
              files: proof.files,
            })}
          </p>
          <dl className="space-y-1 text-xs">
            <div>
              <dt className="font-medium">{t('detail.proof.registryDigest')}</dt>
              <dd className="break-all font-mono">{proof.registryDigest}</dd>
            </div>
            <div>
              <dt className="font-medium">{t('detail.proof.sha256')}</dt>
              <dd className="break-all font-mono">{proof.sha256}</dd>
            </div>
          </dl>
          {proof.notes.length > 0 && (
            <div>
              <h4 className="text-xs font-medium">{t('detail.proof.notes')}</h4>
              <ul className="ms-4 list-disc text-xs text-muted-foreground">
                {proof.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              const file = proofFile(proof);
              downloadText(file.name, file.json);
            }}
          >
            {t('detail.proof.download')}
          </Button>
        </div>
      ) : !request.allowed.erase ? (
        <p className="text-sm text-muted-foreground">{t('detail.erase.blocked')}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('detail.erase.intro')}</p>
          {error && (
            <Alert tone="danger" role="alert">
              {t(`errors.${errorKey(error)}`)}
            </Alert>
          )}
          <Button
            variant="secondary"
            disabled={dry.isPending || run.isPending}
            onClick={() => dry.mutate()}
          >
            {dry.isPending && <Spinner />}
            {dry.isPending ? t('detail.erase.previewing') : t('detail.erase.preview')}
          </Button>

          {preview && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium">{t('detail.erase.previewTitle')}</h3>
              <p className="text-xs text-muted-foreground">{t('detail.erase.previewNote')}</p>
              <ReportTable report={preview} />
              <Field
                label={t('detail.erase.confirmLabel', { phrase: erasePhrase(request.reference) })}
                htmlFor="privacy-erase-confirm"
                hint={t('detail.erase.confirmHint')}
              >
                <Input
                  id="privacy-erase-confirm"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Button
                variant="danger"
                disabled={!matches || run.isPending || dry.isPending}
                data-agent-risk="high"
                onClick={() => run.mutate()}
              >
                {run.isPending && <Spinner />}
                {run.isPending ? t('detail.erase.executing') : t('detail.erase.execute')}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
