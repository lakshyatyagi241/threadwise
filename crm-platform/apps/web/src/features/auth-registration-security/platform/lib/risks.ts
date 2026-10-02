import type { SecurityOverviewResponse } from '@crm/contracts';
import { eventsHref } from './events';

type Risk = SecurityOverviewResponse['risks'][number];

/** How the Owner column reads: the person's name, or "System" when nobody acted. */
export type RiskOwner =
  | { kind: 'name'; name: string }
  | { kind: 'system' }
  /** The API had no name to show (a deleted account): say what kind of actor it was. */
  | { kind: 'type'; type: Exclude<Risk['actorKind'], 'system'> };

/** How the Workspace column reads: the workspace's name, "<app> Platform", or a dash. */
export type RiskWorkspace =
  { kind: 'name'; name: string } | { kind: 'platform' } | { kind: 'none' };

export interface RiskRow {
  severity: Risk['severity'];
  signal: string;
  /** Null when the detail adds nothing: empty, or just the signal again. */
  detail: string | null;
  workspace: RiskWorkspace;
  owner: RiskOwner;
  at: string;
  /** The events viewer filtered to this signal. */
  inspectHref: string;
}

export function riskOwner(risk: Pick<Risk, 'actor' | 'actorKind'>): RiskOwner {
  if (risk.actorKind === 'system') return { kind: 'system' };
  const name = risk.actor.trim();
  return name ? { kind: 'name', name } : { kind: 'type', type: risk.actorKind };
}

export function riskWorkspace(risk: Pick<Risk, 'workspace' | 'scope'>): RiskWorkspace {
  const name = risk.workspace?.trim();
  if (name) return { kind: 'name', name };
  return risk.scope === 'platform' ? { kind: 'platform' } : { kind: 'none' };
}

export function riskDetail(signal: string, detail: string): string | null {
  const d = detail.trim();
  return d === '' || d === signal.trim() ? null : d;
}

export function shapeRisk(risk: Risk): RiskRow {
  return {
    severity: risk.severity,
    signal: risk.signal,
    detail: riskDetail(risk.signal, risk.detail),
    workspace: riskWorkspace(risk),
    owner: riskOwner(risk),
    at: risk.at,
    inspectHref: eventsHref({ event: risk.signal }),
  };
}

/** The queue's "See all" link: every failure in the events viewer. */
export const seeAllRisksHref = (): string => eventsHref({ status: 'failure' });

/** Row tint: failures read red and medium items amber; a watch item stays plain. */
export const riskRowTone = (severity: Risk['severity']): 'danger' | 'warning' | null =>
  severity === 'high' ? 'danger' : severity === 'medium' ? 'warning' : null;
