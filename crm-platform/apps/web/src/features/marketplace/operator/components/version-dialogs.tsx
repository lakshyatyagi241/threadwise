'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  marketScopeSummaries,
  newScopes,
  type MarketOperatorApp,
  type MarketOperatorVersion,
} from '@crm/contracts';
import { Button, ConfirmDialog, Field, Modal, Spinner, Textarea } from '@crm/ui';
import {
  APPROVE_NOTE_MAX,
  REJECT_NOTE_MAX,
  REJECT_NOTE_MIN,
  approveCheck,
  rejectCheck,
} from '../lib/confirmations';
import { ErrorLine, ScopeList } from './ui';

const NS = 'marketplace.operator.versionDialogs';

type VersionFacts = Pick<MarketOperatorVersion, 'id' | 'version' | 'scopes'>;

/** Approve a version, with an optional note for the record. Needs `platform.market.review`. */
export function ApproveDialog({
  app,
  version,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  app: Pick<MarketOperatorApp, 'name'>;
  version: VersionFacts;
  busy?: boolean;
  error?: unknown;
  onConfirm: (note: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations(`${NS}.approve`);
  const [note, setNote] = useState('');
  const check = approveCheck(note);
  return (
    <Modal
      open
      title={t('title', { name: app.name, version: version.version })}
      closeLabel={t('close')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button disabled={!check.ok || busy} onClick={() => onConfirm(note.trim())}>
            {busy && <Spinner />}
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t('body')}</p>
        <Field
          label={t('note')}
          htmlFor="approve-note"
          hint={t('noteHint', { max: APPROVE_NOTE_MAX })}
        >
          <Textarea
            id="approve-note"
            rows={3}
            value={note}
            invalid={check.tooLong}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <ErrorLine error={error} />
      </div>
    </Modal>
  );
}

/** Reject a version with the reason the developer will read: at least five characters, with a live count. Needs `platform.market.review`. */
export function RejectDialog({
  app,
  version,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  app: Pick<MarketOperatorApp, 'name'>;
  version: VersionFacts;
  busy?: boolean;
  error?: unknown;
  onConfirm: (note: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations(`${NS}.reject`);
  const [note, setNote] = useState('');
  const check = rejectCheck(note);
  return (
    <Modal
      open
      title={t('title', { name: app.name, version: version.version })}
      closeLabel={t('close')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={!check.ok || busy}
            onClick={() => onConfirm(note.trim())}
          >
            {busy && <Spinner />}
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t('body')}</p>
        <Field
          label={t('note')}
          htmlFor="reject-note"
          hint={t('noteHint', { min: REJECT_NOTE_MIN, max: REJECT_NOTE_MAX })}
        >
          <Textarea
            id="reject-note"
            rows={4}
            required
            value={note}
            invalid={note.trim() !== '' && !check.ok}
            aria-describedby="reject-note-count"
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <p
          id="reject-note-count"
          className={`text-xs tabular-nums ${check.ok ? 'text-muted-foreground' : 'text-danger'}`}
          aria-live="polite"
        >
          {t('count', { count: check.length, min: REJECT_NOTE_MIN, max: REJECT_NOTE_MAX })}
        </p>
        <ErrorLine error={error} />
      </div>
    </Modal>
  );
}

/**
 * Publish confirmation: says what happens to the installations (those whose granted permissions already cover the version move to it at
 * once, the rest wait for their admin) and, when the version asks for permissions the published one does not, names them.
 */
export function PublishDialog({
  app,
  version,
  published,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  app: Pick<MarketOperatorApp, 'name' | 'installCount' | 'status'>;
  version: VersionFacts;
  /** The version published now, whose permissions are what installations hold. */
  published: Pick<MarketOperatorVersion, 'version' | 'scopes'> | null;
  busy?: boolean;
  error?: unknown;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations(`${NS}.publish`);
  const added = published ? newScopes(published.scopes, version.scopes) : [];
  return (
    <ConfirmDialog
      open
      title={t('title', { name: app.name, version: version.version })}
      confirmLabel={t('confirm', { version: version.version })}
      cancelLabel={t('cancel')}
      busy={busy}
      onConfirm={onConfirm}
      onClose={onClose}
      message={
        <div className="space-y-3">
          <p>{t('body', { name: app.name, version: version.version })}</p>
          <ul className="list-disc space-y-1 ps-5">
            <li>{t('effects.retire')}</li>
            <li>{t('effects.moveSame')}</li>
            <li>{t('effects.moveMore')}</li>
            <li>{t('effects.killed')}</li>
          </ul>
          <p className="font-medium">{t('installs', { count: app.installCount })}</p>
          {published === null && <p>{t('first')}</p>}
          {added.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-warning/40 bg-warning/10 p-3 text-foreground">
              <p className="font-medium">{t('addedScopes', { count: added.length })}</p>
              <ScopeList scopes={marketScopeSummaries(added)} raw={added} />
            </div>
          )}
          <ErrorLine error={error} />
        </div>
      }
    />
  );
}
