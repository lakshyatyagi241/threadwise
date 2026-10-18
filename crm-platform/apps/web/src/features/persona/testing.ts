import {
  GENERIC_PERSONA_DEFINITION,
  resolvePersona,
  type PersonaDefinition,
  type PersonaView,
  type WorkspaceOverrides,
  type OperatorOverrides,
} from '@crm/contracts';

/**
 * Test helpers: the session's `org.persona` as the API builds it, from a persona definition and the two override layers, using the
 * very resolver the API runs (`resolvePersona`). No second implementation of the merge in the tests.
 */
export function viewFrom(input: {
  definition: PersonaDefinition;
  key?: string;
  operator?: OperatorOverrides | null;
  workspace?: WorkspaceOverrides | null;
  showAll?: boolean;
}): PersonaView {
  const { defaultVisibility, modules } = resolvePersona({
    definition: input.definition,
    operator: input.operator ?? null,
    workspace: input.workspace ?? null,
    showAll: input.showAll ?? false,
  });
  return {
    key: input.key ?? 'test',
    version: 1,
    rev: 1,
    solo: false,
    showAll: input.showAll ?? false,
    defaultVisibility,
    modules,
  };
}

/** The `generic` persona exactly as a workspace on it gets it. */
export const genericView = (): PersonaView =>
  viewFrom({ definition: GENERIC_PERSONA_DEFINITION, key: 'generic' });

/** A deny-list persona: everything shown except the listed ids. */
export function denyList(ids: readonly string[]): PersonaDefinition {
  return {
    ...GENERIC_PERSONA_DEFINITION,
    modules: {
      default: 'show',
      ids: Object.fromEntries(ids.map((id) => [id, 'hide' as const])),
    },
  };
}

/** An allow-list persona (a clinic-like one): everything hidden except the listed ids. */
export function allowList(ids: readonly string[]): PersonaDefinition {
  return {
    ...GENERIC_PERSONA_DEFINITION,
    modules: {
      default: 'hide',
      ids: Object.fromEntries(ids.map((id) => [id, 'show' as const])),
    },
  };
}
