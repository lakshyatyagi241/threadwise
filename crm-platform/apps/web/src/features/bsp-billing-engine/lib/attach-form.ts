import { isCreditCurrency, type BspWabaCandidate } from '@crm/contracts';
import { wabaTail } from './format';

/** One option value per (workspace, number): the pair the attach request needs. */
export const optionValue = (c: Pick<BspWabaCandidate, 'workspaceId' | 'wabaId'>): string =>
  `${c.workspaceId}|${c.wabaId}`;

export function parseOption(value: string): { workspaceId: string; wabaId: string } | null {
  const i = value.indexOf('|');
  if (i < 1 || i === value.length - 1) return null;
  return { workspaceId: value.slice(0, i), wabaId: value.slice(i + 1) };
}

export interface OptionLabelParts {
  workspace: string;
  phone: string | null;
  tail: string;
}

/** Workspace, the number's phone (or its label) and the end of the WABA id, so two numbers of one workspace tell apart. */
export const optionParts = (c: BspWabaCandidate): OptionLabelParts => ({
  workspace: c.workspaceName,
  phone: c.phone ?? c.displayLabel,
  tail: wabaTail(c.wabaId, 4).replace('…', ''),
});

/**
 * The currency preselected for a number: the workspace's own when Meta accepts it, else the base currency when it does, else the
 * first Meta accepts. Locked once attached, so the default is the one least likely to be wrong.
 */
export function defaultCurrency(
  candidate: Pick<BspWabaCandidate, 'workspaceCurrency'> | undefined,
  baseCurrency: string,
  allowed: readonly string[],
): string {
  const own = candidate?.workspaceCurrency?.toUpperCase();
  if (own && isCreditCurrency(own)) return own;
  if (isCreditCurrency(baseCurrency)) return baseCurrency;
  return allowed[0] ?? 'USD';
}
