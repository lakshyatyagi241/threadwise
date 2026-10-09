import { z } from 'zod';

/**
 * The `api_library` flow node ("API (from library)", Integrations, WhatsApp only): runs a saved API for the contact of the run.
 *
 * Leaves by port `success` (1) when the API answered 2xx, by `error` (2) when anything else happened (the API is gone, the address is
 * blocked, the function threw, a timeout, a non-2xx). The answer is saved under `save` (JSON text, plus every field as `<save>.<path>`)
 * and each of the API's `responseVariables` as `<ApiName>.<path>`; the API's mapping then writes fields into the contact.
 */
export const FLOW_API_LIBRARY_NODE_TYPE = 'api_library';
export const FLOW_API_LIBRARY_SAVE_DEFAULT = 'api_response';

export const apiLibraryNodeDataSchema = z.object({
  /** The saved API's id, or '' until one is picked. */
  apiId: z.union([z.string().uuid(), z.literal('')]),
  /** Shown on the node card; the runtime uses `apiId`. */
  apiName: z.string().default(''),
  /** Per-variable overrides: a value or `{{flow_variable}}` for a variable the API declares. Not listed: the run's variable, the contact property, then the default. */
  inputs: z.array(z.object({ name: z.string().min(1), value: z.string() })).default([]),
  /** The flow variable the answer is saved under. */
  save: z.string().default(FLOW_API_LIBRARY_SAVE_DEFAULT),
});
export type ApiLibraryNodeData = z.infer<typeof apiLibraryNodeDataSchema>;
