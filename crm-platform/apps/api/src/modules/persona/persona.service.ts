import { Injectable, Logger } from '@nestjs/common';
import {
  parseOperatorOverrides,
  parseWorkspaceOverrides,
  personaDefinitionSchema,
  resolvePersona,
  type PersonaDefinition,
  type PersonaView,
} from '@crm/contracts';
import { PersonaRepository } from './persona.repository';

/** A resolved view is memoised per (workspace, rev, version) for this long. Any write bumps `rev`, so a stale entry is never asked for. */
const VIEW_TTL_MS = 30_000;
/** "No such version" is remembered briefly so a bad pointer does not cost a query per request. */
const MISSING_TTL_MS = 5_000;
const MAX_VIEWS = 5_000;
const MAX_DEFINITIONS = 200;

interface Timed<T> {
  value: T;
  until: number;
}

/**
 * The persona of a workspace, resolved (docs/specs/persona-profiles.md, sections 6 and 7). It answers one question for the web:
 * "which modules does this workspace not draw?". It NEVER closes an API route and no guard reads it: `@RequirePermission` and
 * `@RequirePlanFeature` stay the only server gates (spec 7.1), and hiding is a menu decision, not a security boundary.
 *
 * Unknown means "show everything" (spec 7.3): a workspace with no row, a persona or version that cannot be found, a definition that no
 * longer parses, or a failed read all resolve to `null`, which hides nothing. A workspace is never broken by its persona.
 *
 * Caching: the workspace row (a single indexed read, joined to the persona's `current_version`) is read on every call, because that is
 * where `rev` lives. What it saves is the work after it: a published version never changes, so its parsed definition is kept, and the
 * resolved view is memoised by `(org, rev, version)`.
 */
@Injectable()
export class PersonaService {
  private readonly logger = new Logger(PersonaService.name);
  private readonly views = new Map<string, Timed<PersonaView>>();
  private readonly definitions = new Map<string, Timed<PersonaDefinition | null>>();

  constructor(private readonly repo: PersonaRepository) {}

  /** The workspace's persona view, or `null` when nothing is known (nothing is hidden). Never throws. */
  async resolve(orgId: number): Promise<PersonaView | null> {
    try {
      return await this.resolveOrThrow(orgId);
    } catch (error) {
      this.logger.warn(
        `persona view unavailable for org ${orgId}, showing everything: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async resolveOrThrow(orgId: number): Promise<PersonaView | null> {
    const row = await this.repo.workspaceRecord(orgId);
    if (!row) return null;

    // Following the latest published version unless pinned; fall back to the accepted version when the persona has none.
    const version = row.pinned ? row.personaVersion : (row.currentVersion ?? row.personaVersion);
    const now = Date.now();
    const viewKey = `${orgId}:${row.epoch}:${row.rev}:${row.personaKey}@${version}`;
    const hit = this.views.get(viewKey);
    if (hit && hit.until > now) return hit.value;

    const definition = await this.definition(orgId, row.personaKey, version);
    if (!definition) return null;

    const visibility = resolvePersona({
      definition,
      operator: parseOperatorOverrides(row.operatorOverrides),
      workspace: parseWorkspaceOverrides(row.workspaceOverrides),
      showAll: row.showAllModules,
    });
    const view: PersonaView = {
      key: row.personaKey,
      version,
      rev: row.rev,
      // `auto` needs the seat count and the onboarding flow (phase 4); until then only an explicit "on" is solo.
      solo: row.soloUi === 'on',
      showAll: row.showAllModules,
      defaultVisibility: visibility.defaultVisibility,
      modules: visibility.modules,
    };
    this.remember(this.views, viewKey, view, now + VIEW_TTL_MS, MAX_VIEWS);
    return view;
  }

  private async definition(
    orgId: number,
    key: string,
    version: number,
  ): Promise<PersonaDefinition | null> {
    const cacheKey = `${key}@${version}`;
    const now = Date.now();
    const hit = this.definitions.get(cacheKey);
    if (hit && hit.until > now) return hit.value;

    const raw = await this.repo.publishedDefinition(orgId, key, version);
    const parsed = raw === null ? null : personaDefinitionSchema.safeParse(raw);
    if (parsed && !parsed.success) {
      this.logger.warn(`persona ${key} v${version} does not match the definition schema`);
    }
    const definition = parsed?.success ? parsed.data : null;
    // A found definition is immutable, so it is kept; a missing or broken one is only remembered for a moment.
    this.remember(
      this.definitions,
      cacheKey,
      definition,
      definition ? Number.MAX_SAFE_INTEGER : now + MISSING_TTL_MS,
      MAX_DEFINITIONS,
    );
    return definition;
  }

  private remember<T>(
    store: Map<string, Timed<T>>,
    key: string,
    value: T,
    until: number,
    max: number,
  ): void {
    if (store.size >= max) {
      // drop the oldest entry (Map keeps insertion order)
      const oldest = store.keys().next();
      if (!oldest.done) store.delete(oldest.value);
    }
    store.set(key, { value, until });
  }
}
