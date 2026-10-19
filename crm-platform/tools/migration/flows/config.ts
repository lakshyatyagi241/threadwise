/**
 * The visible switches of the flows and widgets step. Every default is the one recommended in spec C and is listed in the README under
 * "Stage 2: flows and chatbot widgets". The values a run used are recorded in migration.run_log (`_flows` / `options`), and reconcile
 * compares its own flags with them.
 */
export type FlowVersionPolicy = 'published' | 'draft' | 'newest';
export const FLOW_VERSION_POLICIES: FlowVersionPolicy[] = ['published', 'draft', 'newest'];

export interface FlowOptions {
  /**
   * Q1: which version of a bot is "latest".
   *   published (default): the published version (newest publishedAt), else the newest version of any status, else the bot_workspace draft
   *   draft:               the bot_workspace draft (the editable copy), else as `published`
   *   newest:              the newest version of any status (createdAt / publishedAt), else the bot_workspace draft
   */
  flowVersion?: FlowVersionPolicy;
  /** Q7: a WhatsApp bot (channel whatsapp, no whatsapp_number) that has widget configuration also becomes a widget. Default off. */
  widgetsForWhatsappBots?: boolean;
  /** Q15: the plan's flow cap (0 = unlimited). Read from the target by the run; the overflow is quarantined PLAN_LIMIT. */
  flowLimit?: number;
  /** Q15: the plan's chatbot-widget cap (0 = unlimited). */
  widgetLimit?: number;
}

export interface FlowSettings {
  flowVersion: FlowVersionPolicy;
  widgetsForWhatsappBots: boolean;
  flowLimit: number;
  widgetLimit: number;
}

export class FlowsConfigError extends Error {
  constructor(message: string) {
    super(`FLOWS_CONFIG: ${message}`);
  }
}

export function resolveFlows(o: FlowOptions = {}): FlowSettings {
  const flowVersion = o.flowVersion ?? 'published';
  if (!FLOW_VERSION_POLICIES.includes(flowVersion))
    throw new FlowsConfigError(
      `--flow-version must be one of ${FLOW_VERSION_POLICIES.join(' | ')} (got "${String(flowVersion)}")`,
    );
  const lim = (v: number | undefined, name: string): number => {
    const n = v ?? 0;
    if (!Number.isInteger(n) || n < 0)
      throw new FlowsConfigError(`${name} must be a whole number, 0 for unlimited`);
    return n;
  };
  return {
    flowVersion,
    widgetsForWhatsappBots: o.widgetsForWhatsappBots ?? true,
    flowLimit: lim(o.flowLimit, 'the flow limit'),
    widgetLimit: lim(o.widgetLimit, 'the widget limit'),
  };
}

/** run_log collection that records the options of the last run (the same pattern as `_bcast`). */
export const FLOWS_COLLECTION = '_flows';
/** What every imported flow is filed under (flows.category, at most 64 characters). */
export const FLOW_CATEGORY = 'Waboo chatbot';
/**
 * A widget with an EMPTY allow-list answers every origin (originAllowed), so an imported widget carries one entry that no real site
 * can match (".invalid" is reserved and never resolves) and is also paused. A person opens the widget, sets the real domains and
 * activates it.
 */
export const WIDGET_CLOSED_DOMAIN = 'migration-import.invalid';
