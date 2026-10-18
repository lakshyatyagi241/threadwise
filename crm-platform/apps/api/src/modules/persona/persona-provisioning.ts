import { sql } from 'drizzle-orm';
import { GENERIC_PERSONA_KEY } from '@crm/contracts';
import type { Tx } from '@crm/db';

/**
 * Gives a new workspace its persona row: the `generic` persona at its latest published version, "auto" solo mode, no overrides
 * (docs/specs/persona-profiles.md, section 10 step 3). Called by organization provisioning inside the SAME transaction that creates the
 * organization, so a workspace never exists without one. Idempotent.
 *
 * Existing workspaces were given theirs by the backfill in migration 20261230090200 (solo mode OFF, onboarding marked done); a new one
 * starts with `auto` because the persona onboarding (phase 4) is for workspaces created from now on.
 */
export async function provisionWorkspacePersona(tx: Tx, orgId: number): Promise<void> {
  await tx.execute(sql`
    INSERT INTO workspace_persona (org_id, persona_key, persona_version, solo_ui)
    SELECT ${orgId}, p.key, COALESCE(p.current_version, 1), 'auto'
      FROM personas p
     WHERE p.key = ${GENERIC_PERSONA_KEY}
    ON CONFLICT (org_id) DO NOTHING
  `);
}
