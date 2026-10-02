'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useToast } from '@crm/ui';
import { invalidateDocs, KEYS, patchDocInCache, removeDocsFromCache } from '../api/hooks';
import type { DocInput, DocRow, SalesDoc, SendInput, SendResult } from '../api/schemas';
import { salesDocsApi } from '../api/service';
import { errorKind } from '../lib/errors';
import type { SalesDocKind } from '../lib/kinds';
import { useErrorText } from './parts';

/**
 * Every write on a document, with its toast and cache upkeep in one place so the list, the builder and the panels behave the
 * same. Each function resolves to the result (a document, a send result, or `true` for a delete) and to null when the call
 * failed (the person has been told why).
 */
export function useDocActions() {
  const t = useTranslations('sales-docs.toast');
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();

  async function run<T>(
    fn: () => Promise<T>,
    okText: (r: T) => string | null,
    after?: (r: T) => void,
  ): Promise<T | null> {
    try {
      const r = await fn();
      after?.(r);
      await invalidateDocs(qc);
      const text = okText(r);
      if (text) toast(text, 'success');
      return r;
    } catch (e) {
      toast(errorText(e), 'danger');
      // The document moved under us (someone else, or the buyer): show what is true now.
      const kind = errorKind(e);
      if (
        kind === 'conflict' ||
        kind === 'invalidTransition' ||
        kind === 'alreadyConverted' ||
        kind === 'notEditable' ||
        kind === 'expired' ||
        kind === 'alreadyDecided'
      ) {
        await qc.invalidateQueries({ queryKey: KEYS.all });
      }
      return null;
    }
  }

  const cache = (d: SalesDoc) => patchDocInCache(qc, d);
  const number = (d: Pick<DocRow, 'number'>) => ({ number: d.number });

  return {
    create: (kind: SalesDocKind, input: DocInput) =>
      run(
        () => salesDocsApi.create(kind, input),
        (d) => t('created', number(d)),
        cache,
      ),
    save: (doc: SalesDoc, input: DocInput) =>
      run(
        () => salesDocsApi.update(doc, input),
        (d) => t('saved', number(d)),
        cache,
      ),
    accept: (doc: DocRow, note?: string) =>
      run(
        () => salesDocsApi.accept(doc.id, note),
        (d) => t('accepted', number(d)),
        cache,
      ),
    decline: (doc: DocRow, note?: string) =>
      run(
        () => salesDocsApi.decline(doc.id, note),
        (d) => t('declined', number(d)),
        cache,
      ),
    revise: (doc: DocRow) =>
      run(
        () => salesDocsApi.revise(doc.id),
        (d) => t('revised', { number: d.number, revision: d.revision }),
        cache,
      ),
    extend: (doc: DocRow, validUntil: string) =>
      run(
        () => salesDocsApi.extend(doc.id, validUntil),
        (d) => t('extended', number(d)),
        cache,
      ),
    send: (doc: DocRow, input: SendInput): Promise<SendResult | null> =>
      run(
        () => salesDocsApi.send(doc.id, input),
        (r) => t(`delivery.${r.delivery.status}`, number(r.doc)),
        (r) => cache(r.doc),
      ),
    duplicate: (doc: DocRow) =>
      run(
        () => salesDocsApi.duplicate(doc.id),
        (d) => t('duplicated', number(d)),
        cache,
      ),
    convertInvoice: (doc: DocRow) =>
      run(
        () => salesDocsApi.convertInvoice(doc.id),
        (d) => t('convertedInvoice', number(d)),
        cache,
      ),
    convertDeal: (doc: DocRow) =>
      run(
        () => salesDocsApi.convertDeal(doc.id),
        (r) => t('convertedDeal', { number: r.doc.number, deal: r.deal.name }),
        (r) => cache(r.doc),
      ),
    remove: async (doc: Pick<DocRow, 'id' | 'number'>): Promise<boolean> => {
      const done = await run(
        () => salesDocsApi.remove(doc.id).then(() => true),
        () => t('deleted', number(doc)),
        () => removeDocsFromCache(qc, new Set([doc.id])),
      );
      return done === true;
    },
  };
}
