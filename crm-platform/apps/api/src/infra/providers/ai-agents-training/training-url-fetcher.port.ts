/**
 * Fetches a public page for a URL knowledge entry (AIAG). A port so the domain never opens a socket itself and tests never reach the
 * network. The adapter owns the SSRF defence; the domain only turns the body into text.
 */
export const TRAINING_URL_FETCHER = Symbol('TRAINING_URL_FETCHER');

export type TrainingUrlResult =
  { ok: true; body: string; contentType: string | null } | { ok: false; error: string };

export interface TrainingUrlFetcher {
  /** Never throws: a refusal or a failure comes back as `{ ok: false, error }`, the sentence shown on the entry. */
  fetch(url: string): Promise<TrainingUrlResult>;
}
