import type { FlowType } from '@crm/contracts';

/** The builder a workspace uses: its own choice (Flows > Builder) or else the platform default (Admin > Platform settings > Flow builder). */
export type BuilderMode = 'simple' | 'advanced';

/**
 * Where "Open" goes. The Simple builder only handles messaging (chat) flows; with it on, those open there and everything else (a call
 * flow) still needs the canvas.
 */
export function openHref(mode: BuilderMode, id: string, flowType: FlowType | string): string {
  return mode === 'simple' && flowType === 'chat' ? `/flows/simple/${id}` : `/flows/builder/${id}`;
}

/** Where "Create flow" goes in Simple mode; the canvas mode asks messaging or call first. */
export function newHref(mode: BuilderMode): string {
  return mode === 'simple' ? '/flows/simple' : '/flows/builder';
}
