'use client';

import { useTranslations } from 'next-intl';
import { Button, Modal } from '@crm/ui';
import type { HotkeyAction } from '../lib/hotkeys';

const KEYS: Array<{ action: HotkeyAction; keys: string[] }> = [
  { action: 'next', keys: ['J', '↓'] },
  { action: 'prev', keys: ['K', '↑'] },
  { action: 'open', keys: ['Enter'] },
  { action: 'toggleComplete', keys: ['E'] },
  { action: 'toggleSelect', keys: ['X'] },
  { action: 'newTask', keys: ['N'] },
  { action: 'focusSearch', keys: ['/'] },
  { action: 'clearSelection', keys: ['Esc'] },
  { action: 'help', keys: ['?'] },
];

/** The keyboard shortcuts of the list, opened with "?" or from the toolbar. */
export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('tasks.shortcuts');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('close')}
        </Button>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">{t('intro')}</p>
      <dl className="divide-y divide-border text-sm">
        {KEYS.map(({ action, keys }) => (
          <div key={action} className="flex items-center justify-between gap-4 py-2">
            <dt>{t(`actions.${action}`)}</dt>
            <dd className="flex gap-1">
              {keys.map((k) => (
                <kbd
                  key={k}
                  className="min-w-6 rounded border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-xs"
                >
                  {k}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
