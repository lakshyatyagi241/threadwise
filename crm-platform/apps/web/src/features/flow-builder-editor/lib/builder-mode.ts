import type { FlowType } from '@crm/contracts';

/** The builder a workspace uses: its own choice (Flows > Builder) or else the platform default (Admin > Platform settings > Flow builder). */
export type BuilderMode = 'simple' | 'advanced';

/**
 * Where "Open" goes. The Simple builder only handles messaging (chat) flows; with it on, those open there and everything else (a call
 * flow) still needs the canvas.
 */
export function openHref(mode: BuilderMode, id: string, flowType: FlowType | string): string {
  return mode === 'simple' && (flowType === 'chat' || flowType === 'web')
    ? `/flows/simple/${id}`
    : `/flows/builder/${id}`;
}

/** Where "Create flow" goes. Both builders ask for the channel first (the create sheet), because a bot is built for one channel. */
export function newHref(mode: BuilderMode, channel: 'chat' | 'web' = 'chat'): string {
  const base = mode === 'simple' ? '/flows/simple' : '/flows/builder';
  return channel === 'web' ? `${base}?type=web` : base;
}
