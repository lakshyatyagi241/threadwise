/** The pure helpers of an earlier broadcast's page (TW-BCAST-030 to 036): labels, the engine tag, the reference and the delete rule. */

import { isUnofficialEngine } from '@/lib/unofficial-whatsapp';

/** `completed_with_errors` reads "Completed With Errors". */
export const statusLabel = (status: string) =>
  status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const PROVIDERS: Record<string, string> = {
  baileys: 'Unofficial API',
  waba: 'WABA',
  twilio: 'Twilio',
};
export const providerLabel = (p: string | null) => PROVIDERS[(p ?? '').toLowerCase()] ?? '—';

/**
 * The engine tag of an existing broadcast. One sent through the unofficial engine keeps showing (the data is preserved) but reads
 * `disabledLabel` ("Unofficial (disabled)") while the platform has the engine switched off.
 */
export const providerTag = (
  p: string | null,
  unofficialEnabled: boolean,
  disabledLabel: string,
): string => (isUnofficialEngine(p) && !unofficialEnabled ? disabledLabel : providerLabel(p));

/** Reference showed `BR-0042` from the numeric id; ids are uuids here, so the reference is the start of the uuid. */
export const reference = (uuid: string) => `BR-${uuid.slice(0, 8).toUpperCase()}`;

/** Only a broadcast that is still scheduled (not started) can be deleted. */
export const canDelete = (status: string) => status === 'scheduled';

/** The one-decimal percentages the tiles show, from the summary's numbers. */
export const pct1 = (n: number) => n.toFixed(1);
