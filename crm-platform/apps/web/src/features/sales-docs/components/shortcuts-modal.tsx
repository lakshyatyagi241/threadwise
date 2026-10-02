'use client';

import { useTranslations } from 'next-intl';
import { Modal } from '@crm/ui';
import type { ListHotkey } from '../lib/hotkeys';

const ROWS: Array<{ action: ListHotkey; keys: string[] }> = [
  { action: 'next', keys: ['j', '↓'] },
  { action: 'prev', keys: ['k', '↑'] },
  { action: 'open', keys: ['Enter'] },
  { action: 'toggleSelect', keys: ['x'] },
  { action: 'newDoc', keys: ['n'] },
  { action: 'focusSearch', keys: ['/'] },
  { action: 'clearSelection', keys: ['Esc'] },
  { action: 'help', keys: ['?'] },
];

const BUILDER: Array<{ action: 'save' | 'send' | 'addRow'; keys: string[] }> = [
  { action: 'save', keys: ['Ctrl', 'S'] },
  { action: 'send', keys: ['Ctrl', 'Enter'] },
  { action: 'addRow', keys: ['Alt', 'N'] },
];

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex gap-1" dir="ltr">
      {keys.map((k) => (
        <kbd
          key={k}
          className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** The keys of the list and of the builder, in a dialog opened with "?" or the keyboard button. */
export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('sales-docs.shortcuts');
  return (
    <Modal open={open} onClose={onClose} title={t('title')} closeLabel={t('close')}>
      <div className="space-y-4">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('list')}
          </h3>
          <ul className="divide-y divide-border text-sm">
            {ROWS.map((r) => (
              <li key={r.action} className="flex items-center justify-between gap-4 py-2">
                <span>{t(`actions.${r.action}`)}</span>
                <Keys keys={r.keys} />
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('builder')}
          </h3>
          <ul className="divide-y divide-border text-sm">
            {BUILDER.map((r) => (
              <li key={r.action} className="flex items-center justify-between gap-4 py-2">
                <span>{t(`actions.${r.action}`)}</span>
                <Keys keys={r.keys} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  );
}
