'use client';

import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Alert, MenuItem } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useSubjectHold } from '../api/legal-holds';
import { PlaceHoldDialog, ReleaseHoldDialog } from './hold-dialogs';

/**
 * The legal hold of one contact, for the contact's page. Everything here is for people who may read the register
 * (`privacy.requests.read`); for everyone else this asks the server nothing and shows nothing, so a hold is neither revealed nor hinted at.
 *
 *  - `banner`: "Legal hold: erasure and deletion paused", with the reason, the case reference and the review date. Whether a hold covers the
 *    whole workspace is said as well (it cannot be released from the contact).
 *  - `items`: Place / Release in the "..." menu, for people who may manage data requests.
 *  - `dialogs`: the dialogs those items open; render them outside the menu (the menu unmounts its items when it closes).
 *  - `held`: for the layout around the banner.
 */
export function useContactLegalHold(contactId: string): {
  banner: ReactNode;
  items: ReactNode;
  dialogs: ReactNode;
  held: boolean;
} {
  const t = useTranslations('privacy-requests.legalHold');
  const f = useFormatter();
  const canRead = useCan('privacy.requests.read');
  const canManage = useCan('privacy.requests.manage');
  const status = useSubjectHold('contact', contactId, canRead);
  const [placing, setPlacing] = useState(false);
  const [releasing, setReleasing] = useState(false);

  if (!canRead || !status.data) return { banner: null, items: null, dialogs: null, held: false };
  const { held, hold, viaWorkspace } = status.data;

  const banner =
    held && hold ? (
      <Alert tone="warning" data-testid="contact-legal-hold-banner" className="space-y-1">
        <p className="font-semibold">{viaWorkspace ? t('workspaceBanner') : t('contactBanner')}</p>
        <p className="text-xs">
          {t(`category.${hold.reasonCategory}`)}
          {' - '}
          {t('banner.caseRef', { caseRef: hold.caseRef })}
          {hold.reviewAt
            ? ` - ${t(hold.reviewDue ? 'banner.reviewOverdue' : 'banner.reviewBy', {
                date: f.dateTime(new Date(hold.reviewAt), { dateStyle: 'medium' }),
              })}`
            : ''}
        </p>
        <p className="text-xs">
          {t('banner.effects')}{' '}
          <Link href="/privacy-requests/legal-holds" className="underline">
            {t('banner.open')}
          </Link>
        </p>
      </Alert>
    ) : null;

  const items = !canManage ? null : held && hold && !viaWorkspace ? (
    <MenuItem onSelect={() => setReleasing(true)}>{t('menu.release')}</MenuItem>
  ) : !held ? (
    <MenuItem onSelect={() => setPlacing(true)}>{t('menu.place')}</MenuItem>
  ) : null;

  const dialogs = canManage ? (
    <>
      <PlaceHoldDialog
        open={placing}
        onClose={() => setPlacing(false)}
        scope="contact"
        subjectId={contactId}
      />
      {hold && !viaWorkspace && (
        <ReleaseHoldDialog open={releasing} onClose={() => setReleasing(false)} hold={hold} />
      )}
    </>
  ) : null;

  return { banner, items, dialogs, held };
}
