'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ConfirmDialog, Field, Input, Spinner, cn, useToast } from '@crm/ui';
import type { CatalogSender, CollectionResponse } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, sendCatalog, useOverview } from '../api/catalog';
import {
  createCollection,
  deleteCollection,
  updateCollection,
  useCollections,
} from '../api/collections';
import {
  EMPTY_COLLECTION_FORM,
  buildCollectionInput,
  buildCollectionUpdate,
  formFromCollection,
  liveProductIds,
  pickerItems,
  type PickItem,
} from '../lib/collection-model';
import { HEADER_MAX, buildCollectionSend } from '../lib/send-model';
import { CollectionEditor } from './collection-editor';
import { CollectionsIcon, PlusIcon, SendIcon, ChevronRightIcon } from './icons';
import { CARD, KICKER, LoadError, LoadingBlock, ProductThumb } from './parts';
import { SenderSelect } from './sender-select';
import { useErrorText } from './use-error-text';

type Panel = 'none' | 'send' | 'edit';

/** The inline send panel of a collection: one recipient number, an optional header and the sender; sent as a list message. */
function SendPanel({
  collection,
  senders,
}: {
  collection: CollectionResponse;
  senders: CatalogSender[];
}) {
  const t = useTranslations('catalogProducts.collections.send');
  const errorText = useErrorText();
  const qc = useQueryClient();
  const [number, setNumber] = useState('');
  const [header, setHeader] = useState('');
  const [sender, setSender] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    tone: 'info' | 'ok' | 'error';
    text: string;
    errors: string[];
  } | null>(null);
  const ids = liveProductIds(collection);

  if (ids.length === 0) {
    return <p className="text-[12px] text-danger">{t('noLive')}</p>;
  }

  const send = async () => {
    if (!number.trim()) {
      setStatus({ tone: 'error', text: t('needNumber'), errors: [] });
      return;
    }
    setBusy(true);
    setStatus({ tone: 'info', text: t('sending'), errors: [] });
    try {
      const res = await sendCatalog(
        buildCollectionSend({ number, header, sender, productIds: ids }),
      );
      setStatus(
        res.ok
          ? {
              tone: 'ok',
              text: `${t('sent', { count: res.sent })}${res.failed > 0 ? ` · ${t('someFailed', { count: res.failed })}` : ''}`,
              errors: res.errors,
            }
          : { tone: 'error', text: t('failed'), errors: res.errors },
      );
      void qc.invalidateQueries({ queryKey: KEYS.activity });
      void qc.invalidateQueries({ queryKey: KEYS.sendOptions });
    } catch (e) {
      setStatus({ tone: 'error', text: errorText(e), errors: [] });
    } finally {
      setBusy(false);
    }
  };

  const id = `cat-col-send-${collection.id}`;
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={<span className={KICKER}>{t('number')}</span>} htmlFor={`${id}-number`}>
          <Input
            id={`${id}-number`}
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder={t('numberPlaceholder')}
            inputMode="tel"
          />
        </Field>
        <Field label={<span className={KICKER}>{t('header')}</span>} htmlFor={`${id}-header`}>
          <Input
            id={`${id}-header`}
            value={header}
            maxLength={HEADER_MAX}
            onChange={(e) => setHeader(e.target.value)}
            placeholder={t('headerPlaceholder')}
          />
        </Field>
        <Field label={<span className={KICKER}>{t('from')}</span>} htmlFor={`${id}-from`}>
          <SenderSelect
            id={`${id}-from`}
            senders={senders}
            value={sender}
            onChange={setSender}
            placeholder={t('auto')}
          />
        </Field>
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div
          role={status?.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'min-w-0 text-[11px]',
            status?.tone === 'ok' && 'text-success',
            status?.tone === 'error' && 'text-danger',
            (!status || status.tone === 'info') && 'text-muted-foreground',
          )}
        >
          {status?.text}
          {status && status.errors.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 ps-5">
              {status.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
        <Button
          variant="brand"
          className="shrink-0 rounded-full px-4 text-[12.5px]"
          disabled={busy}
          onClick={() => void send()}
        >
          {busy && <Spinner />}
          {t('go')}
        </Button>
      </div>
    </div>
  );
}

/** One collection: the stacked thumbnails, the name and count, and the Send, Edit and Delete actions with their panels. */
function CollectionCard({
  collection,
  pick,
  senders,
  canSend,
  canManage,
  onDelete,
}: {
  collection: CollectionResponse;
  pick: PickItem[];
  senders: CatalogSender[];
  canSend: boolean;
  canManage: boolean;
  onDelete: (c: CollectionResponse) => void;
}) {
  const t = useTranslations('catalogProducts.collections');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [panel, setPanel] = useState<Panel>('none');
  const [editKey, setEditKey] = useState(0);
  const toggle = (p: Exclude<Panel, 'none'>) => setPanel((cur) => (cur === p ? 'none' : p));

  const reload = async () => {
    await qc.invalidateQueries({ queryKey: KEYS.collections });
    setEditKey((k) => k + 1);
  };

  const save = async (form: Parameters<typeof buildCollectionUpdate>[0]) => {
    await updateCollection(collection.id, buildCollectionUpdate(form, collection.rowVersion));
    toast(t('updated'), 'success');
    setPanel('none');
    await qc.invalidateQueries({ queryKey: KEYS.collections });
  };

  const btn =
    'rounded-full border border-border px-3 py-1.5 text-[11.5px] font-medium outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <article className={cn(CARD, 'overflow-hidden')}>
      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <div className="flex shrink-0 -space-x-2 rtl:space-x-reverse" aria-hidden="true">
          {collection.products.slice(0, 4).map((m) => (
            <ProductThumb
              key={m.id}
              url={m.imageUrl}
              size="size-9"
              className="border-2 border-background"
            />
          ))}
        </div>
        <div className="min-w-[160px] flex-1">
          <h3 className="font-serif text-[16px] font-normal leading-tight">{collection.name}</h3>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {t('productCount', { count: collection.productCount })}
            {collection.description ? ` · ${collection.description.slice(0, 60)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSend && (
            <Button
              variant="brand"
              aria-expanded={panel === 'send'}
              className="rounded-full px-3 text-[11.5px]"
              size="sm"
              onClick={() => toggle('send')}
            >
              <SendIcon className="size-3" />
              {t('send.button')}
            </Button>
          )}
          {canManage && (
            <>
              <button
                type="button"
                aria-expanded={panel === 'edit'}
                className={btn}
                onClick={() => toggle('edit')}
              >
                {t('edit')}
              </button>
              <button
                type="button"
                className={cn(btn, 'text-danger hover:border-danger/40 hover:bg-danger/10')}
                onClick={() => onDelete(collection)}
              >
                {t('delete')}
              </button>
            </>
          )}
        </div>
      </div>

      {panel === 'send' && canSend && (
        <div className="border-t border-border px-5 pb-5 pt-4">
          <SendPanel collection={collection} senders={senders} />
        </div>
      )}
      {panel === 'edit' && canManage && (
        <div className="border-t border-border px-5 pb-5 pt-4">
          <CollectionEditor
            key={`${collection.id}-${collection.rowVersion}-${editKey}`}
            idPrefix={`cat-col-edit-${collection.id}`}
            initial={formFromCollection(collection)}
            items={pickerItems(pick, collection.products)}
            submitLabel={t('saveChanges')}
            onSubmit={save}
            onReload={() => void reload()}
          />
        </div>
      )}
    </article>
  );
}

/**
 * The Collections tab (TW-CAT-017, 018): saved, ordered product groups sent as one list message. Create under "New
 * collection", then Send, Edit or Delete on each card.
 */
export function CollectionsTab() {
  const t = useTranslations('catalogProducts.collections');
  const errorText = useErrorText();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canManage = useCan('cat.collections.manage');
  const canSend = useCan('cat.catalog.send');
  const list = useCollections();
  const overview = useOverview();
  const [pendingDelete, setPendingDelete] = useState<CollectionResponse | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [createKey, setCreateKey] = useState(0);

  if (list.isPending) return <LoadingBlock label={t('loading')} />;
  if (list.isError) {
    return (
      <LoadError error={list.error} title={t('loadError')} onRetry={() => void list.refetch()} />
    );
  }
  const { data: collections, pickProducts } = list.data;
  const senders = overview.data?.senders ?? [];

  const create = async (form: Parameters<typeof buildCollectionInput>[0]) => {
    await createCollection(buildCollectionInput(form));
    toast(t('created'), 'success');
    setCreateKey((k) => k + 1);
    await qc.invalidateQueries({ queryKey: KEYS.collections });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteCollection(pendingDelete.id);
      toast(t('deleted'), 'success');
      setPendingDelete(null);
      await qc.invalidateQueries({ queryKey: KEYS.collections });
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className={cn(CARD, 'flex flex-wrap items-start gap-3 p-5')}>
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-success/10 text-success">
          <CollectionsIcon className="size-4" />
        </span>
        <div className="min-w-[200px] flex-1">
          <h2 className="font-serif text-[17px] font-normal leading-tight">{t('title')}</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{t('intro')}</p>
        </div>
      </section>

      {canManage && (
        <details className={cn(CARD, 'group')}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <span className="inline-flex items-center gap-2 font-serif text-[16px]">
              <PlusIcon className="size-4 text-brand dark:text-primary" strokeWidth={1.8} />
              {t('new')}
            </span>
            <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90" />
          </summary>
          <div className="border-t border-border px-5 pb-5 pt-4">
            <CollectionEditor
              key={createKey}
              idPrefix="cat-col-new"
              initial={EMPTY_COLLECTION_FORM}
              items={pickProducts}
              submitLabel={t('create')}
              onSubmit={create}
            />
          </div>
        </details>
      )}

      {collections.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-background p-8 text-center text-[13px] text-muted-foreground">
          {t('empty')}
        </div>
      ) : (
        collections.map((c) => (
          <CollectionCard
            key={c.id}
            collection={c}
            pick={pickProducts}
            senders={senders}
            canSend={canSend}
            canManage={canManage}
            onDelete={setPendingDelete}
          />
        ))
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('deleteTitle')}
        message={t('deleteBody', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
