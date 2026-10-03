/**
 * The bundled, INDICATIVE Meta pricing card used by "Sync Meta costs" when no live endpoint is set up (WD-WALLET-007). Amounts are
 * per delivered message in USD and approximate: Meta revises its card quarterly (1 Jan, Apr, Jul, Oct), so this is a starting
 * point for the margin column, never the source of truth for invoicing. Verify against Meta's published pricing before relying
 * on a figure. The version string is shown to the operator after every sync.
 */
export const BUNDLED_RATE_CARD_VERSION = 'indicative-2026-10';

export interface BundledRate {
  country: string;
  marketing: number;
  utility: number;
  authentication: number;
}

export const BUNDLED_RATE_CARD: readonly BundledRate[] = [
  { country: 'IN', marketing: 0.0107, utility: 0.0028, authentication: 0.0028 },
  { country: 'US', marketing: 0.025, utility: 0.004, authentication: 0.0135 },
  { country: 'CA', marketing: 0.0219, utility: 0.0036, authentication: 0.0135 },
  { country: 'GB', marketing: 0.0529, utility: 0.022, authentication: 0.0358 },
  { country: 'DE', marketing: 0.1365, utility: 0.0636, authentication: 0.0636 },
  { country: 'FR', marketing: 0.1432, utility: 0.0537, authentication: 0.0537 },
  { country: 'ES', marketing: 0.0615, utility: 0.0345, authentication: 0.0345 },
  { country: 'IT', marketing: 0.0691, utility: 0.0378, authentication: 0.0378 },
  { country: 'NL', marketing: 0.1597, utility: 0.0504, authentication: 0.0504 },
  { country: 'BR', marketing: 0.0625, utility: 0.0068, authentication: 0.0315 },
  { country: 'MX', marketing: 0.0305, utility: 0.0085, authentication: 0.0306 },
  { country: 'AR', marketing: 0.0618, utility: 0.0353, authentication: 0.0367 },
  { country: 'CO', marketing: 0.0125, utility: 0.0008, authentication: 0.0125 },
  { country: 'CL', marketing: 0.0889, utility: 0.02, authentication: 0.0358 },
  { country: 'AE', marketing: 0.0384, utility: 0.0157, authentication: 0.0258 },
  { country: 'SA', marketing: 0.0455, utility: 0.0107, authentication: 0.0188 },
  { country: 'ID', marketing: 0.0411, utility: 0.02, authentication: 0.03 },
  { country: 'PK', marketing: 0.0473, utility: 0.0053, authentication: 0.06 },
  { country: 'NG', marketing: 0.0516, utility: 0.0067, authentication: 0.06 },
  { country: 'ZA', marketing: 0.0379, utility: 0.0076, authentication: 0.0309 },
  { country: 'EG', marketing: 0.0644, utility: 0.0087, authentication: 0.06 },
  { country: 'TR', marketing: 0.0109, utility: 0.0053, authentication: 0.0109 },
  { country: 'RU', marketing: 0.0369, utility: 0.0273, authentication: 0.03 },
  { country: 'MY', marketing: 0.086, utility: 0.015, authentication: 0.03 },
  { country: 'SG', marketing: 0.06, utility: 0.02, authentication: 0.03 },
  { country: 'AU', marketing: 0.08, utility: 0.033, authentication: 0.045 },
];
