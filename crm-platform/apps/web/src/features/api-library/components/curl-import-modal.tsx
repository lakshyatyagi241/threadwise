'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, Field, Modal, Textarea } from '@crm/ui';
import { parseCurl } from '../lib/curl';
import { stashImport } from '../lib/import-handoff';

/** The old console's "Import API's": paste a cURL command, and the New screen opens with it filled in. */
export function CurlImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('api-library.import');
  const tc = useTranslations('api-library.common');
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  function insert() {
    const parsed = parseCurl(text);
    if (!parsed) {
      setError(t('invalid'));
      return;
    }
    stashImport(parsed);
    setText('');
    setError(null);
    onClose();
    router.push('/api-library/new?from=curl');
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      title={t('title')}
      size="md"
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={insert} disabled={text.trim() === ''}>
            {t('insert')}
          </Button>
        </>
      }
    >
      <Field label={t('label')} htmlFor="alib-curl" hint={t('hint')} error={error}>
        <Textarea
          id="alib-curl"
          rows={7}
          dir="ltr"
          className="font-mono text-xs"
          value={text}
          invalid={error !== null}
          placeholder={t('placeholder')}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
      </Field>
    </Modal>
  );
}
