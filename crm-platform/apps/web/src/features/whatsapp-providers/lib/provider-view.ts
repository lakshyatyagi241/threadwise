import type { WhatsappProvider, WhatsappProviderStatus } from '@crm/contracts';
import type { WapAccess } from './permissions';

/** Why a lifecycle action is not available on a provider, so the screen can say so instead of hiding the button. */
export type ActionBlock = 'default' | 'builtin' | 'inUse';

export interface ActionState {
  /** The operator may use it and the provider is in a state where it makes sense. */
  enabled: boolean;
  /** Set when the operator has the permission and the state fits, but the API would refuse. */
  blocked?: ActionBlock;
}

export interface ProviderActions {
  /** The edit form (a built-in provider only takes label, notes and billing mode). */
  edit: boolean;
  /** Test connection. */
  test: boolean;
  activate: ActionState;
  disable: ActionState;
  archive: ActionState;
  makeDefault: ActionState;
  /** Offered on the provider that is the default. */
  clearDefault: boolean;
}

const OFF: ActionState = { enabled: false };

/**
 * What an operator can do with one provider, from the permissions and the provider's own state (the same rules the API enforces:
 * the default cannot be disabled or archived, a built-in provider cannot be archived, a provider with numbers or workspaces on it
 * cannot be archived, only an active provider can be the default). The server stays the authority.
 */
export function providerActions(p: WhatsappProvider, access: WapAccess): ProviderActions {
  if (!access.manage) {
    return {
      edit: false,
      test: false,
      activate: OFF,
      disable: OFF,
      archive: OFF,
      makeDefault: OFF,
      clearDefault: false,
    };
  }
  const active = p.status === 'active';
  const archivedAlready = p.status === 'archived';
  const archiveBlock: ActionBlock | undefined = p.isDefault
    ? 'default'
    : p.builtin
      ? 'builtin'
      : p.numberCount > 0 || p.workspaceCount > 0
        ? 'inUse'
        : undefined;
  return {
    edit: true,
    test: !archivedAlready,
    activate: { enabled: !active },
    disable: active
      ? { enabled: !p.isDefault, ...(p.isDefault ? { blocked: 'default' as const } : {}) }
      : OFF,
    archive: archivedAlready
      ? OFF
      : { enabled: archiveBlock === undefined, ...(archiveBlock ? { blocked: archiveBlock } : {}) },
    makeDefault: { enabled: active && !p.isDefault },
    clearDefault: p.isDefault,
  };
}

const STATUS_RANK: Record<WhatsappProviderStatus, number> = { active: 0, disabled: 1, archived: 2 };

/** The default first, then active, disabled and archived; built-in providers before added ones; then by label. */
export function sortProviders(list: readonly WhatsappProvider[]): WhatsappProvider[] {
  return [...list].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.status !== b.status) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (!!a.builtin !== !!b.builtin) return a.builtin ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

export type StatusFilter = 'all' | WhatsappProviderStatus;
export const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'active', 'disabled', 'archived'];

export function filterProviders(
  list: readonly WhatsappProvider[],
  status: StatusFilter,
  search: string,
): WhatsappProvider[] {
  const q = search.trim().toLowerCase();
  return list.filter(
    (p) =>
      (status === 'all' || p.status === status) &&
      (q === '' || p.key.toLowerCase().includes(q) || p.label.toLowerCase().includes(q)),
  );
}

export function statusCounts(list: readonly WhatsappProvider[]): Record<StatusFilter, number> {
  return {
    all: list.length,
    active: list.filter((p) => p.status === 'active').length,
    disabled: list.filter((p) => p.status === 'disabled').length,
    archived: list.filter((p) => p.status === 'archived').length,
  };
}

/** The providers a new number or an override can point at: active ones only. */
export const selectableProviders = (list: readonly WhatsappProvider[]): WhatsappProvider[] =>
  sortProviders(list.filter((p) => p.status === 'active'));

/** The route of the console WhatsApp settings page, where the built-in Meta app and Interakt partner credentials live. */
export const CONSOLE_WHATSAPP_SETTINGS_PATH = '/admin/settings/whatsapp';
