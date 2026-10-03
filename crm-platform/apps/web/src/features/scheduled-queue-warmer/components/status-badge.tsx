import { useTranslations } from 'next-intl';
import type { ScheduleStatus } from '@crm/contracts';
import { Badge } from '@crm/ui';
import { statusTone } from '../lib/schedule-model';

export function StatusBadge({ status }: { status: ScheduleStatus }) {
  const t = useTranslations('scheduled-queue-warmer.status');
  return (
    <Badge tone={statusTone(status)} data-status={status}>
      {t(status)}
    </Badge>
  );
}
