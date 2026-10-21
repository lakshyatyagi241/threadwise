import { pageResponseSchema, statusOptionResponseSchema } from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api';
import { can, useSession } from '@/lib/session/use-session';

const optionPageSchema = pageResponseSchema(statusOptionResponseSchema);
const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * How to name a contact's lifecycle stage and status: by the workspace's own words (its stage and status options) when the person may
 * read them, else by the platform's built-in names (the stages and the four statuses), else as the stored value. The contact screen does
 * the same; the conversation carries only the stored value, so without this the panel would show codes such as `new` or `keyxUqSr`.
 */
export function useLifecycleNames() {
  const { t } = useTranslation();
  const session = useSession();
  const canRead = can(session.data, 'record.contact-properties.read');
  const options = useQuery({
    queryKey: ['inbox', 'contact-status-options'],
    enabled: canRead,
    retry: false,
    staleTime: FIVE_MINUTES,
    queryFn: async ({ signal }) =>
      (
        await apiFetch('/v2/status-options', {
          query: { moduleKey: 'contacts', limit: 200 },
          schema: optionPageSchema,
          signal,
        })
      ).data,
  }).data;
  const own = (group: readonly string[], value: string) =>
    options?.find((o) => o.isActive && group.includes(o.optionGroup) && o.value === value)?.label;
  return {
    stageName: (value: string): string =>
      own(['lifecycle_stage'], value) ?? t(`contacts.stage.${value}`, { defaultValue: value }),
    statusName: (value: string): string =>
      own(['status', 'contact_status'], value) ??
      t(`contactProps.lifecycle.fallbackStatus.${value}`, { defaultValue: value }),
  };
}
