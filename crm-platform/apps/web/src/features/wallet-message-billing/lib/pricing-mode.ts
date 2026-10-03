import { PRICING_MODES, type PricingMode, type UpdateSwitchesInput } from '@crm/contracts';

export const MODES: readonly PricingMode[] = PRICING_MODES;

/** The pricing mode is saved on its own: the request carries that one switch and nothing else, so it never rewrites the others. */
export const pricingModeBody = (mode: PricingMode): UpdateSwitchesInput => ({ pricingMode: mode });

/** Whether the choice differs from what is saved (the Save button stays off until it does). */
export const modeChanged = (saved: PricingMode, draft: PricingMode): boolean => saved !== draft;
