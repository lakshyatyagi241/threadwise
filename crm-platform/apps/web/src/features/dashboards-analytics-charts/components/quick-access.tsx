'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  QUICK_ACCESS_CATALOG,
  QUICK_ACCESS_MAX,
  type QuickAccessItem,
  type QuickAccessResponse,
} from '@crm/contracts';
import { Button, Checkbox, Input, Modal, ToastProvider, useToast } from '@crm/ui';
import { useQuickAccess, useSaveQuickAccess } from '../api/hooks';
import { Panel } from './parts';

const BASE = 'dashboards-analytics-charts.quickAccess';

interface Row {
  label: string;
  url: string;
}

/** The editor's starting point: the catalog keys that are pinned, and the custom links (WD-DASH-009). */
export function editorState(items: QuickAccessItem[]): { keys: string[]; rows: Row[] } {
  const keys: string[] = [];
  const rows: Row[] = [];
  for (const i of items) {
    if ('key' in i) keys.push(i.key);
    else rows.push({ label: i.label, url: i.url });
  }
  return { keys, rows };
}

/** Catalog order for ticked pages, then custom rows with both fields filled: the saved shape (no reordering, as in WaDesk). */
export function editorItems(keys: string[], rows: Row[]): QuickAccessItem[] {
  return [
    ...QUICK_ACCESS_CATALOG.filter((c) => keys.includes(c.key)).map((c) => ({ key: c.key })),
    ...rows
      .filter((r) => r.label.trim() && r.url.trim())
      .map((r) => ({ label: r.label, url: r.url })),
  ];
}

function Editor({ data, onClose }: { data: QuickAccessResponse; onClose: () => void }) {
  const t = useTranslations(BASE);
  const { toast } = useToast();
  const save = useSaveQuickAccess();
  const start = editorState(data.items);
  const [keys, setKeys] = useState<string[]>(start.keys);
  const [rows, setRows] = useState<Row[]>(start.rows);
  const count = keys.length + rows.length;
  const full = () => toast(t('limit'), 'danger');

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      eyebrow={t('modalEyebrow')}
      title={t('modalTitle')}
      closeLabel={t('cancel')}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground" data-testid="qa-counter">
            {t('counter', { n: count })}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              disabled={save.isPending}
              onClick={() =>
                save.mutate(editorItems(keys, rows), {
                  onSuccess: () => {
                    toast(t('saved'), 'success');
                    onClose();
                  },
                  onError: () => toast(t('failed'), 'danger'),
                })
              }
            >
              {save.isPending ? t('saving') : t('save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('pages')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {QUICK_ACCESS_CATALOG.map((c) => (
              <Checkbox
                key={c.key}
                id={`qa-${c.key}`}
                label={c.label}
                checked={keys.includes(c.key)}
                onChange={(e) => {
                  if (!e.target.checked) return setKeys(keys.filter((k) => k !== c.key));
                  if (count >= QUICK_ACCESS_MAX) return full();
                  setKeys([...keys, c.key]);
                }}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('custom')}</legend>
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2">
              <Input
                aria-label={t('labelPlaceholder')}
                placeholder={t('labelPlaceholder')}
                maxLength={40}
                value={r.label}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                }
              />
              <Input
                aria-label={t('urlPlaceholder')}
                placeholder={t('urlPlaceholder')}
                maxLength={255}
                value={r.url}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                }
              />
              <Button
                variant="ghost"
                aria-label={t('removeCustom')}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                x
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              count >= QUICK_ACCESS_MAX ? full() : setRows([...rows, { label: '', url: '' }])
            }
          >
            {t('addCustom')}
          </Button>
        </fieldset>
      </div>
    </Modal>
  );
}

function QuickAccessInner() {
  const t = useTranslations(BASE);
  const q = useQuickAccess();
  const [editing, setEditing] = useState(false);
  if (!q.data) return null;
  const tiles = q.data.tiles;
  return (
    <Panel
      title={t('title')}
      subtitle={t('kicker')}
      action={
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
          {t('edit')}
        </Button>
      }
    >
      {tiles.length === 0 ? (
        <Button variant="secondary" onClick={() => setEditing(true)}>
          {t('empty')}
        </Button>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="quick-access-tiles">
          {tiles.map((tile, i) => (
            <li key={`${tile.key ?? tile.url}-${i}`}>
              <Link
                href={tile.url}
                title={tile.desc}
                className="block rounded-md border border-border px-3 py-2.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
              >
                {tile.label}
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {tile.desc}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {editing && <Editor data={q.data} onClose={() => setEditing(false)} />}
    </Panel>
  );
}

/** WD-DASH-009: the "Shortcuts" section of the dashboard; the toast host is local so the page needs no wrapper. */
export function QuickAccess() {
  return (
    <ToastProvider>
      <QuickAccessInner />
    </ToastProvider>
  );
}
