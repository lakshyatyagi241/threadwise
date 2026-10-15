'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TemplateSummary } from '@crm/contracts';
import { Button, Modal } from '@crm/ui';
import { templateCurl } from '../lib/template-curl';

/**
 * "Copy cURL" of a template: the request that sends it through the customer API, to copy into a terminal or an app. The key is a
 * placeholder (a key is shown once, when it is created, under Developers).
 */
export function CurlDialog({
  template,
  baseUrl,
  onClose,
}: {
  template: TemplateSummary | null;
  /** The public API address with `/api/v1` (read on the server). */
  baseUrl: string;
  onClose: () => void;
}) {
  const t = useTranslations('message-templates.curl');
  /** The template whose request was just copied: another template, or a closed dialog, never reads "Copied". */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const box = useRef<HTMLPreElement>(null);
  const text = template ? templateCurl(baseUrl, template) : '';

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    if (!template) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(template.id);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // The clipboard can be blocked (plain http, no permission): the text is selected instead, ready for Ctrl+C.
      const el = box.current;
      if (!el) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }

  function close() {
    window.clearTimeout(timer.current);
    setCopiedId(null);
    onClose();
  }

  return (
    <Modal
      open={template !== null}
      onClose={close}
      size="lg"
      eyebrow={template?.name ?? ''}
      title={t('title')}
      closeLabel={t('close')}
    >
      <p className="mb-3 text-[13px] text-muted-foreground">{t('hint')}</p>
      <div className="relative">
        <pre
          ref={box}
          data-testid="template-curl"
          tabIndex={0}
          className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-[#0F1720] p-4 pe-24 font-mono text-[12px] leading-relaxed text-[#D7E3DC]"
        >
          {text}
        </pre>
        <Button
          variant="secondary"
          size="sm"
          className="absolute end-3 top-3"
          onClick={() => void copy()}
        >
          {template && copiedId === template.id ? t('copied') : t('copy')}
        </Button>
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground">
        {t.rich('keyHint', {
          link: (chunks) => (
            <Link href="/developers" className="font-semibold text-brand hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </Modal>
  );
}
