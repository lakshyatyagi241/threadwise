'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  QUICK_ACCESS_CATALOG,
  QUICK_ACCESS_LABEL_MAX,
  QUICK_ACCESS_MAX,
  QUICK_ACCESS_URL_MAX,
  type QuickAccessTile,
} from '@crm/contracts';
import { Alert, Button, Checkbox, Input, Modal } from '@crm/ui';
import { useSaveQuickAccess } from './api';
import {
  addCustom,
  customRowProblem,
  draftFromTiles,
  pinnedCount,
  toItems,
  toggleKey,
  type Draft,
} from './logic';

const NS = 'admin-console-shell.quickAccess';

/** TW-ASHELL-022: the one editor for the dashboard tiles and the edge drawer. Up to ten pinned pages and own links. */
export function QuickAccessModal({
  open,
  tiles,
  onClose,
}: {
  open: boolean;
  tiles: readonly QuickAccessTile[];
  onClose: () => void;
}) {
  const t = useTranslations(NS);
  return (
    <Modal open={open} onClose={onClose} title={t('editTitle')} size="lg" closeLabel={t('close')}>
      {/* Remounted on every open so the editor always starts from what is saved. */}
      {open && <Editor tiles={tiles} onClose={onClose} />}
    </Modal>
  );
}

function Editor({ tiles, onClose }: { tiles: readonly QuickAccessTile[]; onClose: () => void }) {
  const t = useTranslations(NS);
  const save = useSaveQuickAccess();
  const [draft, setDraft] = useState<Draft>(() => draftFromTiles(tiles));
  const [refused, setRefused] = useState(false);
  const count = pinnedCount(draft);

  const apply = (r: { draft: Draft; refused: boolean }) => {
    setDraft(r.draft);
    setRefused(r.refused);
  };
  const setCustom = (i: number, patch: Partial<{ label: string; url: string }>) =>
    setDraft((d) => ({ ...d, custom: d.custom.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(toItems(draft), { onSuccess: onClose });
      }}
    >
      <p className="text-sm text-muted-foreground">{t('editNote')}</p>
      {refused && <Alert tone="warning">{t('limit', { max: QUICK_ACCESS_MAX })}</Alert>}
      {save.isError && <Alert tone="danger">{t('saveFailed')}</Alert>}
      <div className="grid gap-2 sm:grid-cols-2">
        {QUICK_ACCESS_CATALOG.map((c) => (
          <div key={c.key} className="rounded-md border border-border p-2">
            <Checkbox
              id={`qa-${c.key}`}
              checked={draft.keys.includes(c.key)}
              onChange={() => apply(toggleKey(draft, c.key))}
              label={
                <span className="min-w-0">
                  <span className="block truncate font-medium">{t(`catalog.${c.key}.label`)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t(`catalog.${c.key}.desc`)}
                  </span>
                </span>
              }
            />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t('customLinks')}</h3>
        {draft.custom.map((c, i) => {
          const problem = customRowProblem(c);
          return (
            <div key={i} className="space-y-1">
              <div className="flex gap-2">
                <Input
                  aria-label={t('linkLabel')}
                  placeholder={t('linkLabel')}
                  maxLength={QUICK_ACCESS_LABEL_MAX}
                  value={c.label}
                  onChange={(e) => setCustom(i, { label: e.target.value })}
                />
                <Input
                  aria-label={t('linkUrl')}
                  placeholder="https://… or /page"
                  maxLength={QUICK_ACCESS_URL_MAX}
                  dir="ltr"
                  value={c.url}
                  onChange={(e) => setCustom(i, { url: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t('removeLink')}
                  onClick={() =>
                    setDraft((d) => ({ ...d, custom: d.custom.filter((_, j) => j !== i) }))
                  }
                >
                  ×
                </Button>
              </div>
              {problem && <p className="text-xs text-danger">{t(`problem.${problem}`)}</p>}
            </div>
          );
        })}
        <Button type="button" variant="secondary" size="sm" onClick={() => apply(addCustom(draft))}>
          {t('addLink')}
        </Button>
      </div>
      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {t('counter', { count, max: QUICK_ACCESS_MAX })}
        </span>
        <span className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t('save')}
          </Button>
        </span>
      </div>
    </form>
  );
}
