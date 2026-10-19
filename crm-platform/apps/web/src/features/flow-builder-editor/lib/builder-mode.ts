import type { FlowType } from '@crm/contracts';

/** The builder a workspace uses: its own choice (Flows > Builder) or else the platform default (Admin > Platform settings > Flow builder). */
export type BuilderMode = 'simple' | 'advanced';

/**
 * Where "Open" goes. Bots (WhatsApp and website chat) are built in the Simple builder whatever the workspace uses, while the migration
 * is on. Automations (the canvas: a messaging flow built on it, and call flows) open on the Advanced canvas.
 */
export function openHref(mode: BuilderMode, id: string, flowType: FlowType | string): string {
  void mode;
  return flowType === 'chat' || flowType === 'web' ? `/flows/simple/${id}` : `/flows/builder/${id}`;
}

/** Where "Create flow" goes for a bot: the Simple builder, with the channel in the link. Automations are created from the create sheet's Advanced rows. */
export function newHref(mode: BuilderMode, channel: 'chat' | 'web' = 'chat'): string {
  void mode;
  return channel === 'web' ? '/flows/simple?type=web' : '/flows/simple';
}
