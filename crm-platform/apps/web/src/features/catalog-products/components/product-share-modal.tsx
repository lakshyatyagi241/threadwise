'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, Modal, Spinner } from '@crm/ui';
import type { ProductResponse } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { getShareLinks, sendProduct } from '../api/products';
import { isValidPhone } from '../lib/share';
import { ErrorLine } from './parts';
import { useErrorText } from './use-error-text';

/** A read-only link box with a Copy button that says "Copied!" for 1.5 seconds. */
function CopyRow({
  id,
  label,
  value,
  copyable,
}: {
  id: string;
  label: string;
  value: string;
  copyable: boolean;
}) {
  const t = useTranslations('catalogProducts.share');
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard can be blocked; the box is selectable, so the link can still be copied by hand.
    }
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-semibold">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="h-9 bg-muted font-mono text-[11.5px]"
        />
        <Button
          variant="brand"
          size="sm"
          className="shrink-0 rounded-full text-[11.5px]"
          disabled={!copyable}
          onClick={() => void copy()}
        >
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>
    </div>
  );
}

/**
 * "Share product" (TW-CAT-022, 023): the storefront link and the WhatsApp deep link to copy, and a box to send the product
 * to one customer's number from the connected sender.
 */
export function ProductShareModal({
  product,
  onClose,
}: {
  product: ProductResponse | null;
  onClose: () => void;
}) {
  const t = useTranslations('catalogProducts.share');
  const errorText = useErrorText();
  const canSend = useCan('cat.catalog.send');
  const id = product?.id ?? null;
  const links = useQuery({
    queryKey: ['cat', 'share-links', id],
    enabled: id !== null,
    queryFn: () => getShareLinks(id as string),
    retry: false,
    staleTime: 0,
  });

  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  if (id !== lastId) {
    // A different product (or closing): start the send row clean, as Reference reset it on each open.
    setLastId(id);
    setPhone('');
    setResult(null);
  }

  const send = async () => {
    if (!id) return;
    if (!isValidPhone(phone)) {
      setResult({ ok: false, text: t('invalidPhone') });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await sendProduct(id, phone.trim());
      setResult({ ok: true, text: res.message || t('sent') });
      setPhone('');
    } catch (e) {
      setResult({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={product !== null}
      onClose={onClose}
      eyebrow={t('eyebrow')}
      title={links.data?.product.name ?? product?.name ?? t('product')}
      footer={
        <Button variant="secondary" className="rounded-full" onClick={onClose}>
          {t('close')}
        </Button>
      }
    >
      {links.isPending ? (
        <div className="flex justify-center py-6">
          <Spinner label={t('loading')} />
        </div>
      ) : links.isError ? (
        <ErrorLine>{errorText(links.error)}</ErrorLine>
      ) : (
        <div className="space-y-2.5 text-[12.5px]">
          <CopyRow
            id="share-public"
            label={t('storefrontLink')}
            value={links.data.publicUrl ?? t('noStorefront')}
            copyable={links.data.publicUrl !== null}
          />
          <CopyRow
            id="share-wa"
            label={t('waLink')}
            value={links.data.waLink ?? t('noPhone')}
            copyable={links.data.waLink !== null}
          />
          {canSend && (
            <div className="mt-1 border-t border-border pt-2.5">
              <label htmlFor="share-send-phone" className="mb-1 block font-semibold">
                {t('sendToCustomer')}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="share-send-phone"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t('phonePlaceholder')}
                  className="h-9 text-[11.5px]"
                />
                <Button
                  variant="brand"
                  size="sm"
                  className="shrink-0 rounded-full text-[11.5px]"
                  disabled={busy}
                  onClick={() => void send()}
                >
                  {busy ? t('sending') : t('send')}
                </Button>
              </div>
              {result && (
                <p
                  role={result.ok ? 'status' : 'alert'}
                  className={`mt-1.5 text-[11px] ${result.ok ? 'text-success' : 'text-danger'}`}
                >
                  {result.text}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
