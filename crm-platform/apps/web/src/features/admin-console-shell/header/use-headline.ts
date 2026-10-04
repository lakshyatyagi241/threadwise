'use client';

import { useTranslations } from 'next-intl';
import type { OperatorNotification } from '@crm/contracts';

/** A feed event's headline in the page language: the API names the event, the screen words it ("Payment received #ORD-7"). */
export function useHeadline(): (n: OperatorNotification) => string {
  const t = useTranslations('admin-console-shell.header.feed');
  return (n) => (n.ref ? `${t(n.titleKey)} ${n.ref}` : t(n.titleKey));
}
