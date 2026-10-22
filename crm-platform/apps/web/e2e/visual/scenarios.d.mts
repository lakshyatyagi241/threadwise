export type Priority = 'P0' | 'P1' | 'P2';
export interface VisualConfig {
  viewports: Record<string, { width: number; height: number }>;
  viewportsByPriority: Record<Priority, string[]>;
  p0: string[];
  p2: string[];
  skipGroups: string[];
  authedGroups: string[];
  consentCookie: string;
  fixedTime: string;
  diff: { maxDiffPixelRatio: number; threshold: number };
  maxShotHeight: number;
  known: Record<string, string>;
  hide: Record<string, string[]>;
}
export interface Scenario {
  id: string;
  url: string;
  priority: Priority;
  authed: boolean;
  viewport: string;
  width: number;
  height: number;
}
export function loadConfig(root?: string): VisualConfig;
export function priorityOf(url: string, cfg: Pick<VisualConfig, 'p0' | 'p2'>): Priority;
export function discoverPages(
  root?: string,
  cfg?: VisualConfig,
): { pages: Array<{ url: string; authed: boolean }>; dynamic: number; skipped: number };
export function scenarioId(url: string, viewport: string): string;
export function buildScenarios(root?: string): Scenario[];
