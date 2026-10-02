import { Injectable, Logger } from '@nestjs/common';
import {
  PLAN_FEATURE_DEFS,
  PLAN_LIMIT_DEFS,
  readStoredManifest,
  type ExtensionManifest,
  type NavContribution,
  type PlanFeatureContribution,
  type PlanLimitContribution,
} from '@crm/contracts';
import { addonsConfig } from '../../config/domains/addons-extension-registry.env';
import { ExtensionStore, type ExtensionRow } from './extension-store';
import { scanModules, type DiskModule } from './module-loader';

export type ModuleSource = 'upload' | 'inplace';

export interface ModuleEntry {
  slug: string;
  manifest: ExtensionManifest;
  /** `upload` = has a registry row (installed from a ZIP); `inplace` = found in the modules folder only. */
  source: ModuleSource;
  /** The single answer to "is this module on". See `merge`. */
  enabled: boolean;
}

export interface RegistrySnapshot {
  at: number;
  rows: ExtensionRow[];
  disk: Map<string, DiskModule>;
  modules: Map<string, ModuleEntry>;
}

/**
 * ONE source of truth per module (fixes TW-ADD-007's QUIRK, where "disable" flipped a flag nothing read):
 *   - a module with a registry row is on iff the row's status is `active`; the `.disabled` marker is ignored
 *   - an in-place module (folder only) is on iff it has no `.disabled` marker
 * The manifest comes from the folder when it is there (disk wins, as in Reference), else from the row.
 */
export function mergeModules(
  rows: ExtensionRow[],
  disk: Map<string, DiskModule>,
): Map<string, ModuleEntry> {
  const out = new Map<string, ModuleEntry>();
  for (const row of rows) {
    const manifest = disk.get(row.slug)?.manifest ?? readStoredManifest(row.manifest);
    if (!manifest) continue;
    out.set(row.slug, { slug: row.slug, manifest, source: 'upload', enabled: row.status === 'active' });
  }
  for (const [slug, mod] of disk) {
    if (out.has(slug)) continue;
    out.set(slug, { slug, manifest: mod.manifest, source: 'inplace', enabled: !mod.disabled });
  }
  return out;
}

const EMPTY: RegistrySnapshot = { at: 0, rows: [], disk: new Map(), modules: new Map() };

/**
 * What the installed modules contribute and whether a module is on (TW-ADD-009/011/012/013/014/015).
 *
 * Answers come from an in-process snapshot that expires after ADDONS_REGISTRY_TTL_MS and is dropped at once by
 * `invalidate()` on every change made through this process.
 * ponytail: other API replicas see a change within the TTL (30 s by default); add Redis pub/sub on `invalidate()`
 * if "instantly everywhere" is ever required.
 *
 * It never breaks a request: any failure (table missing mid-upgrade, database down) yields "no contributions" and
 * every module reads as off, and the next call tries again (TW-ADD-014 rule 1).
 */
@Injectable()
export class ModuleRegistryService {
  private readonly logger = new Logger(ModuleRegistryService.name);
  private cached: RegistrySnapshot | null = null;
  private inflight: Promise<RegistrySnapshot> | null = null;

  constructor(private readonly store: ExtensionStore) {}

  invalidate(): void {
    this.cached = null;
  }

  async snapshot(): Promise<RegistrySnapshot> {
    const ttl = addonsConfig().ADDONS_REGISTRY_TTL_MS;
    if (this.cached && Date.now() - this.cached.at < ttl) return this.cached;
    if (this.inflight) return this.inflight;
    this.inflight = this.load().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async load(): Promise<RegistrySnapshot> {
    try {
      const [rows, disk] = await Promise.all([
        this.store.tx((tx) => this.store.list(tx)),
        scanModules(addonsConfig().modulesDir),
      ]);
      const snap: RegistrySnapshot = { at: Date.now(), rows, disk, modules: mergeModules(rows, disk) };
      this.cached = snap;
      return snap;
    } catch (err) {
      this.logger.warn({ err }, 'module registry unavailable: serving no contributions');
      return EMPTY;
    }
  }

  async isEnabled(slug: string): Promise<boolean> {
    return (await this.snapshot()).modules.get(slug)?.enabled ?? false;
  }

  async enabledModules(): Promise<ModuleEntry[]> {
    return [...(await this.snapshot()).modules.values()].filter((m) => m.enabled);
  }

  /** Navigation entries of enabled modules for one surface, in load order (modules alphabetical, manifest order). */
  async nav(surface: 'admin' | 'user'): Promise<Array<NavContribution & { module: string }>> {
    const mods = await this.enabledModules();
    return mods
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .flatMap((m) => m.manifest.nav[surface].map((n) => ({ ...n, module: m.slug })));
  }

  async planFeatures(): Promise<Array<PlanFeatureContribution & { module: string }>> {
    return this.contributions((m) => m.manifest.planFeatures);
  }

  async planLimits(): Promise<Array<PlanLimitContribution & { module: string }>> {
    return this.contributions((m) => m.manifest.planLimits);
  }

  private async contributions<T extends { key: string }>(
    pick: (m: ModuleEntry) => T[],
  ): Promise<Array<T & { module: string }>> {
    const seen = new Set<string>();
    const out: Array<T & { module: string }> = [];
    for (const m of (await this.enabledModules()).sort((a, b) => a.slug.localeCompare(b.slug))) {
      for (const c of pick(m)) {
        if (seen.has(c.key)) continue; // first module (alphabetical) wins a clashing key
        seen.add(c.key);
        out.push({ ...c, module: m.slug });
      }
    }
    return out;
  }

  /**
   * A plan flag is dormant when a module declares it but no enabled module does (TW-ADD-015): the gate must answer
   * false whatever the stored plan says, so removing a module takes its features away. Core flags are never dormant.
   */
  async isDormantFeature(key: string): Promise<boolean> {
    if (CORE_FEATURE_KEYS.has(key)) return false;
    const snap = await this.snapshot();
    let declared = false;
    for (const m of snap.modules.values()) {
      if (!m.manifest.planFeatures.some((f) => f.key === key)) continue;
      if (m.enabled) return false;
      declared = true;
    }
    return declared;
  }
}

export const CORE_FEATURE_KEYS: ReadonlySet<string> = new Set(PLAN_FEATURE_DEFS.map((d) => d.key));
export const CORE_LIMIT_KEYS: ReadonlySet<string> = new Set(PLAN_LIMIT_DEFS.map((d) => d.key));
