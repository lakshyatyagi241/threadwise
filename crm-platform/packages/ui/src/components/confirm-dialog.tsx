'use client';

import type { ReactNode } from 'react';
import { Button } from './button';
import { Modal } from './modal';
import { Spinner } from './spinner';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** `danger` styles the confirm button for destructive actions. */
  tone?: 'default' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Confirmation before a destructive or irreversible action. Escape and the backdrop cancel. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  busy,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
            // The Help assistant always asks the person before pressing a destructive confirmation.
            data-agent-risk={tone === 'danger' ? 'high' : undefined}
          >
            {busy && <Spinner />}
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted-foreground">{message}</div>
    </Modal>
  );
}
