import { contactViewResponseSchema, pageResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api';

const viewListSchema = pageResponseSchema(contactViewResponseSchema);

/** The views the workspace saved and the person may see (their own and the shared ones). One page holds them all. */
export const listContactViews = (signal?: AbortSignal) =>
  apiFetch('/v2/contact-views', { query: { limit: 200 }, schema: viewListSchema, signal });
