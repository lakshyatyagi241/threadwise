'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '@crm/ui';
import { useOperator } from '../operator-context';
import { sectionEditors, type OperatorSection } from '../operator-role';

/** Shown above a settings form the signed-in role may look at but not change. */
export function ReadOnlyNotice({ section }: { section: OperatorSection }) {
  const t = useTranslations('auth-registration-security.platform.common.readOnly');
  const tRole = useTranslations('auth-registration-security.platform.shell.roles');
  const { operator } = useOperator();
  return <Alert tone="info">{t(sectionEditors(section), { role: tRole(operator.role) })}</Alert>;
}
