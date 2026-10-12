import type { TaskPriority } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { Badge, type BadgeTone } from '@/components/ui/badge';

const TONES: Record<TaskPriority, BadgeTone> = {
  low: 'neutral',
  medium: 'warning',
  high: 'danger',
};

/** How urgent a task is, as a word in a pill: low is quiet, medium amber, high red. */
export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const { t } = useTranslation();
  return <Badge tone={TONES[priority]} label={t(`tasks.priority.${priority}`)} />;
}
