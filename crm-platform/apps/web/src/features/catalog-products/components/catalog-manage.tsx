'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ConfirmDialog, Field, Input, Spinner, useToast } from '@crm/ui';
import type { CatalogSummary } from '@crm/contracts';
import { createCatalog, deleteRemoteCatalog, KEYS, renameCatalog } from '../api/catalog';
import { CARD, KICKER } from './parts';
import { useErrorText } from './use-error-text';

/** Create a brand-new catalog on Meta from here: name it, and it is created under the WABA's business, linked and connected. */
export function CreateCatalogPanel() {
  const t = useTranslations('catalogProducts.manage.create');
  const errorText = useErrorText();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setError(t('needName'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createCatalog({ name: name.trim() });
      toast(t('done'), 'success');
      await qc.invalidateQueries({ queryKey: KEYS.all });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${CARD} p-5`}>
      <h3 className="font-serif text-[18px] font-normal leading-tight">{t('title')}</h3>
      <p className="mt-1 text-[11.5px] text-muted-foreground">{t('intro')}</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Field label={<span className={KICKER}>{t('name')}</span>} htmlFor="cat-create-name">
            <Input
              id="cat-create-name"
              value={name}
              maxLength={191}
              placeholder={t('placeholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>
        <Button
          variant="brand"
          className="rounded-full px-5"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? <Spinner /> : null}
          {t('button')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[11.5px] text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Rename the connected catalog on Meta, or delete it there (the catalog id must be typed back). */
export function ManageCatalogPanel({ catalog }: { catalog: CatalogSummary }) {
  const t = useTranslations('catalogProducts.manage');
  const errorText = useErrorText();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(catalog.catalogName ?? '');
  const [renaming, setRenaming] = useState(false);
  const [confirmId, setConfirmId] = useState('');
  const [askDelete, setAskDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const rename = async () => {
    if (!name.trim()) return;
    setRenaming(true);
    try {
      await renameCatalog({ name: name.trim() });
      toast(t('rename.done'), 'success');
      await qc.invalidateQueries({ queryKey: KEYS.all });
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setRenaming(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteRemoteCatalog({ confirmCatalogId: confirmId.trim() });
      toast(t('delete.done'), 'success');
      setAskDelete(false);
      await qc.invalidateQueries({ queryKey: KEYS.all });
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className={`${CARD} p-5`}>
      <h3 className="font-serif text-[18px] font-normal leading-tight">{t('title')}</h3>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Field label={<span className={KICKER}>{t('rename.label')}</span>} htmlFor="cat-rename">
            <Input
              id="cat-rename"
              value={name}
              maxLength={191}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>
        <Button
          variant="brand"
          className="rounded-full px-5"
          disabled={renaming || !name.trim() || name.trim() === catalog.catalogName}
          onClick={() => void rename()}
        >
          {renaming ? <Spinner /> : null}
          {t('rename.button')}
        </Button>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className={KICKER}>{t('delete.title')}</div>
        <p className="mt-1 text-[11.5px] text-muted-foreground">{t('delete.warning')}</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Field
              label={
                <span className={KICKER}>
                  {t('delete.confirmLabel', { id: catalog.catalogId })}
                </span>
              }
              htmlFor="cat-delete-confirm"
            >
              <Input
                id="cat-delete-confirm"
                value={confirmId}
                onChange={(e) => setConfirmId(e.target.value)}
              />
            </Field>
          </div>
          <Button
            variant="ghost"
            className="rounded-full border border-danger/40 px-5 text-danger hover:bg-danger/10"
            disabled={confirmId.trim() !== catalog.catalogId}
            onClick={() => setAskDelete(true)}
          >
            {t('delete.button')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={askDelete}
        title={t('delete.dialogTitle')}
        message={t('delete.dialogMessage')}
        confirmLabel={t('delete.button')}
        cancelLabel={t('delete.cancel')}
        tone="danger"
        busy={deleting}
        onConfirm={() => void remove()}
        onClose={() => setAskDelete(false)}
      />
    </section>
  );
}
