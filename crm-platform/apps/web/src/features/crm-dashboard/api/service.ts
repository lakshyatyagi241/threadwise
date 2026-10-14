import { crmDashboardResponseSchema, type CrmDashboardResponse } from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api/client';

/** Only what the pickers read; the rest of those responses is ignored. */
const pipelineSchema = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  currency: z.string(),
});
const memberPageSchema = z.object({
  data: z.array(z.object({ id: z.string(), fullName: z.string() })),
});
const teamPageSchema = z.object({ data: z.array(z.object({ id: z.string(), name: z.string() })) });

export type PipelineOption = z.infer<typeof pipelineSchema>;
export interface Option {
  id: string;
  name: string;
}

export const crmDashboardApi = {
  dashboard(
    query: Record<string, string | undefined>,
    signal?: AbortSignal,
  ): Promise<CrmDashboardResponse> {
    return apiFetch('/crm/dashboard', { query, schema: crmDashboardResponseSchema, signal });
  },
  pipelines(signal?: AbortSignal): Promise<PipelineOption[]> {
    return apiFetch('/pipelines', { schema: z.array(pipelineSchema), signal });
  },
  async members(signal?: AbortSignal): Promise<Option[]> {
    const page = await apiFetch('/users', { query: { limit: 200 }, schema: memberPageSchema, signal });
    return page.data.map((m) => ({ id: m.id, name: m.fullName }));
  },
  async teams(signal?: AbortSignal): Promise<Option[]> {
    const page = await apiFetch('/workspace/teams', {
      query: { limit: 100 },
      schema: teamPageSchema,
      signal,
    });
    return page.data;
  },
};
