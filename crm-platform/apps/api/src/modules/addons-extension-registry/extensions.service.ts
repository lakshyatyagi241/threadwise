import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  EXTENSION_SLUG_RE,
  readStoredManifest,
  type ExtensionManifest,
  type ExtensionsPageResponse,
  type InPlaceModule,
  type InstalledExtension,
  type RemoveExtensionResponse,
  type ToggleExtensionResponse,
  type ToggleModuleResponse,
  type UploadExtensionResponse,
  type VerifyPurchaseResponse,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { addonsConfig } from '../../config/domains/addons-extension-registry.env';
import { AuthAuditService } from '../auth';
import { EngineConnectionService, NATIVE_INSTAGRAM_SLUG } from './engine-connections.service';
import { installPackage, removeFiles } from './extension-installer';
import { ExtensionStore, type ExtensionRow } from './extension-store';
import { ModuleRegistryService } from './module-registry.service';
import { scanModules, setModuleDisabled } from './module-loader';
import { inspectPackage } from './package-inspector';

const counts = (m: ExtensionManifest | null) => ({
  navItems: (m?.nav.admin.length ?? 0) + (m?.nav.user.length ?? 0),
  planFeatures: m?.planFeatures.length ?? 0,
  planLimits: m?.planLimits.length ?? 0,
});

export function toInstalled(row: ExtensionRow): InstalledExtension {
  return {
    id: row.uuid,
    slug: row.slug,
    name: row.name,
    version: row.version,
    status: row.status,
    fileCount: row.files?.length ?? 0,
    contributions: counts(readStoredManifest(row.manifest)),
    installedAt: row.installed_at ? new Date(row.installed_at).toISOString() : null,
    rowVersion: row.row_version,
  };
}

/**
 * The operator's view of code add-ons ("modules") and what they can do to them (TW-ADD-001..010, 023).
 *
 * Packages carry data and static files only; nothing in a package is executed by the API (TW-ADD-005 port note):
 * a module's behaviour ships with the product build, and what the registry controls is whether it is ON, what it
 * adds to navigation and to the plan catalogue, and whether its routes answer (ModuleGateGuard).
 *
 * Every mutation writes its audit event in the same transaction as the change. The purchase code is encrypted at
 * rest and never appears in an event, a log line or a response.
 */
@Injectable()
export class ExtensionsService {
  private readonly logger = new Logger(ExtensionsService.name);

  constructor(
    private readonly store: ExtensionStore,
    private readonly registry: ModuleRegistryService,
    private readonly engines: EngineConnectionService,
    private readonly audit: AuthAuditService,
    private readonly crypto: CryptoService,
  ) {}

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }

  // --- TW-ADD-001: the page --------------------------------------------------------------------------------------

  async page(): Promise<ExtensionsPageResponse> {
    const cfg = addonsConfig();
    // Read fresh (not through the registry's snapshot): the page must show what was just changed.
    const [rows, disk] = await Promise.all([
      this.store.tx((tx) => this.store.list(tx)),
      scanModules(cfg.modulesDir),
    ]);
    const known = new Set(rows.map((r) => r.slug));
    const modules: InPlaceModule[] = [...disk.values()]
      .filter((d) => !known.has(d.manifest.slug)) // a slug with a row hides its in-place twin
      .map((d) => ({
        slug: d.manifest.slug,
        name: d.manifest.name,
        version: d.manifest.version,
        active: !d.disabled,
        contributions: counts(d.manifest),
      }));
    return {
      coreVersion: cfg.CORE_VERSION,
      extensions: rows.map(toInstalled),
      modules,
      installedCount: rows.length + modules.length,
      engines: {
        instagram: await this.engines.state('instagram'),
        email: await this.engines.state('email'),
      },
    };
  }

  // --- TW-ADD-002: licence ---------------------------------------------------------------------------------------

  /**
   * ponytail: the licence model itself belongs to the install/licensing domain (INST). Until it exists this checks
   * only that a code was given when one is required; Reference accepted every code, including an empty one, and that
   * bypass is deliberately not ported. Swap this method for the real entitlement check, nothing else changes.
   */
  private checkPurchaseCode(code: string): VerifyPurchaseResponse {
    if (addonsConfig().ADDONS_REQUIRE_PURCHASE_CODE && code.trim() === '') {
      return { ok: false, message: 'Enter your purchase code first.' };
    }
    return { ok: true, message: 'Purchase verified - you can proceed.' };
  }

  async verify(purchaseCode: string): Promise<VerifyPurchaseResponse> {
    const operatorId = this.operatorId();
    const result = this.checkPurchaseCode(purchaseCode);
    await this.store.tx((tx) =>
      this.audit.record(tx, {
        event: 'platform.extension.verify',
        status: result.ok ? 'success' : 'failure',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { outcome: result.ok ? 'valid' : 'invalid' }, // never the code
      }),
    );
    return result;
  }

  // --- TW-ADD-003/004/005: upload and install --------------------------------------------------------------------

  async upload(zip: Buffer, purchaseCode: string): Promise<UploadExtensionResponse> {
    const operatorId = this.operatorId();
    const cfg = addonsConfig();

    // 1. the server re-verifies; the page's Verify step is advisory
    const licence = this.checkPurchaseCode(purchaseCode);
    if (!licence.ok) {
      throw new AppError(
        ERROR_CODES.ADD_PACKAGE_INVALID,
        licence.message,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (zip.length > cfg.ADDONS_MAX_PACKAGE_BYTES) {
      throw new AppError(
        ERROR_CODES.ADD_PACKAGE_TOO_LARGE,
        'The package is larger than the allowed size.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // 2. inspect before anything is written
    const inspection = inspectPackage(zip, {
      coreVersion: cfg.CORE_VERSION,
      maxEntries: cfg.ADDONS_MAX_ENTRIES,
      maxUnpackedBytes: cfg.ADDONS_MAX_UNPACKED_BYTES,
    });
    const { manifest } = inspection;

    // 3. one Instagram engine at a time
    if (manifest.slug === NATIVE_INSTAGRAM_SLUG) {
      const remote = await this.engines.remoteInstagramActive();
      if (remote.active) {
        throw new AppError(
          ERROR_CODES.ADD_ENGINE_CONFLICT,
          `Instagram runs one engine at a time. Disconnect ${remote.brand} first, then import the Instagram add-on.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }

    // 4. extract and record, serialised per slug; the row, the audit event and the files stand or fall together
    const encrypted = purchaseCode.trim() ? this.crypto.encrypt(purchaseCode.trim()) : null;
    const installed = await this.store.tx(async (tx) => {
      await this.store.lockSlug(tx, manifest.slug);
      const files = await installPackage(zip, inspection, cfg.modulesDir);
      try {
        const { row, upgraded } = await this.store.upsert(tx, {
          slug: manifest.slug,
          name: manifest.name,
          version: manifest.version,
          files: files.files,
          manifest,
          purchaseCodeEncrypted: encrypted,
          operatorId,
        });
        await this.audit.record(tx, {
          event: 'platform.extension.installed',
          status: 'success',
          actorType: 'platform_operator',
          actorId: operatorId,
          payload: {
            slug: manifest.slug,
            version: manifest.version,
            files: files.written,
            skipped: files.skipped,
            upgraded,
          },
        });
        return { row, upgraded, files };
      } catch (err) {
        await removeFiles(cfg.modulesDir, files.files);
        throw err;
      }
    });
    this.registry.invalidate();
    this.logger.log({ slug: manifest.slug, files: installed.files.written }, 'extension installed');

    const skippedNote = installed.files.skipped
      ? ` ${installed.files.skipped} protected or unsafe path(s) skipped.`
      : '';
    return {
      ok: true,
      message: `${manifest.name} ${manifest.version} installed - ${installed.files.written} file(s) written.${skippedNote}`,
      extension: toInstalled(installed.row),
      filesWritten: installed.files.written,
      skipped: installed.files.skipped,
      upgraded: installed.upgraded,
    };
  }

  // --- TW-ADD-007: enable / disable (one source of truth: the row) -----------------------------------------------

  async toggle(uuid: string, rowVersion: number): Promise<ToggleExtensionResponse> {
    const operatorId = this.operatorId();
    const result = await this.store.tx(async (tx) => {
      const row = await this.store.byUuid(tx, uuid, true);
      if (!row) throw AppError.notFound('Extension');
      const next = row.status === 'active' ? 'disabled' : 'active';
      const updated = await this.store.setStatus(tx, row.id, next, rowVersion);
      if (!updated) throw AppError.rowVersionConflict('The extension');
      await this.audit.record(tx, {
        event: next === 'active' ? 'platform.extension.enabled' : 'platform.extension.disabled',
        status: 'success',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { slug: row.slug },
      });
      return updated;
    });
    this.registry.invalidate();
    return { ok: true, status: result.status, rowVersion: result.row_version };
  }

  // --- TW-ADD-008: uninstall -------------------------------------------------------------------------------------

  async remove(uuid: string): Promise<RemoveExtensionResponse> {
    const operatorId = this.operatorId();
    const cfg = addonsConfig();
    const result = await this.store.tx(async (tx) => {
      const row = await this.store.byUuid(tx, uuid, true);
      if (!row) throw AppError.notFound('Extension');
      const removed = await removeFiles(cfg.modulesDir, row.files ?? []);
      await this.store.remove(tx, row.id);
      await this.audit.record(tx, {
        event: 'platform.extension.uninstalled',
        status: 'success',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { slug: row.slug, removed },
      });
      return { slug: row.slug, removed };
    });
    this.registry.invalidate();
    if (result.slug === NATIVE_INSTAGRAM_SLUG) await this.engines.reconcileNativeInstagram();
    return {
      ok: true,
      message: `Removed ${result.slug} - ${result.removed} file(s) deleted.`,
      removedFiles: result.removed,
    };
  }

  // --- TW-ADD-010: in-place modules ------------------------------------------------------------------------------

  async toggleModule(slug: string): Promise<ToggleModuleResponse> {
    const operatorId = this.operatorId();
    const cfg = addonsConfig();
    const unknown = () =>
      new AppError(ERROR_CODES.NOT_FOUND, 'Unknown module.', HttpStatus.NOT_FOUND);
    if (!EXTENSION_SLUG_RE.test(slug)) throw unknown();
    const mod = (await scanModules(cfg.modulesDir)).get(slug);
    if (!mod) throw unknown();

    const hasRow = await this.store.tx((tx) => this.store.bySlug(tx, slug));
    if (hasRow) {
      // A package-installed module is switched on its own row; a marker would be a second source of truth.
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'This add-on was installed from a package: use its Enable or Disable switch.',
        HttpStatus.CONFLICT,
      );
    }

    const nowDisabled = !mod.disabled;
    try {
      await setModuleDisabled(cfg.modulesDir, slug, nowDisabled);
    } catch {
      throw new AppError(
        ERROR_CODES.INTERNAL,
        'Could not update the module. Check the add-ons folder is writable.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    await this.store.tx((tx) =>
      this.audit.record(tx, {
        event: nowDisabled ? 'platform.module.disabled' : 'platform.module.enabled',
        status: 'success',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { slug },
      }),
    );
    this.registry.invalidate();
    return {
      ok: true,
      active: !nowDisabled,
      message: nowDisabled
        ? `${mod.manifest.name} deactivated.`
        : `${mod.manifest.name} re-activated.`,
    };
  }
}
