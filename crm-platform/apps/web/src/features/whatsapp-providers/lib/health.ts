import type { Provider, ProviderHealth } from '../api/schemas';

export type HealthTone = 'success' | 'danger' | 'neutral';

/** The status chip's tone and label key for a provider's last health check. */
export function healthView(h: ProviderHealth | null): {
  tone: HealthTone;
  kind: 'ok' | 'failed' | 'never';
} {
  if (!h) return { tone: 'neutral', kind: 'never' };
  return h.ok ? { tone: 'success', kind: 'ok' } : { tone: 'danger', kind: 'failed' };
}

/** A provider with channels cannot be deleted; neither can the default. Disabling the default is refused by the API too. */
export function canDelete(
  p: Pick<Provider, 'channelCount' | 'isDefault' | 'workspaceOverrideCount'>,
): boolean {
  return p.channelCount === 0 && !p.isDefault && p.workspaceOverrideCount === 0;
}

export function canMakeDefault(p: Pick<Provider, 'isDefault' | 'status'>): boolean {
  return !p.isDefault && p.status === 'active';
}

export function canDisable(p: Pick<Provider, 'isDefault' | 'status'>): boolean {
  return p.status === 'active' && !p.isDefault;
}

/** Providers a channel or workspace can be moved to: active, and not the one it is on. */
export function targetsFor(providers: readonly Provider[], fromId?: string | null): Provider[] {
  return providers.filter((p) => p.status === 'active' && p.id !== fromId);
}
