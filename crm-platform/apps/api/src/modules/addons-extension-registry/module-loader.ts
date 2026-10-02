import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXTENSION_SLUG_RE, parseManifestText, type ExtensionManifest } from '@crm/contracts';

export interface DiskModule {
  manifest: ExtensionManifest;
  /** True when the `.disabled` marker exists (only meaningful for in-place modules, see the registry). */
  disabled: boolean;
}

export const DISABLED_MARKER = '.disabled';

/**
 * Module discovery (TW-ADD-009): every `<modulesDir>/<dir>/extension.json` whose manifest parses is a module.
 * A folder whose manifest slug differs from the folder name is ignored: Reference matched toggles on the folder name and
 * the registry on the slug and trusted them to agree; here nothing is loaded that does not.
 * Never throws: a missing directory is "no modules", an unreadable one is skipped.
 */
export async function scanModules(modulesDir: string): Promise<Map<string, DiskModule>> {
  const found = new Map<string, DiskModule>();
  let names: string[];
  try {
    names = (await readdir(modulesDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && EXTENSION_SLUG_RE.test(d.name))
      .map((d) => d.name)
      .sort(); // alphabetical, like glob: there is no dependency ordering between modules
  } catch {
    return found;
  }
  for (const dir of names) {
    let manifest: ExtensionManifest | null = null;
    try {
      manifest = parseManifestText(await readFile(join(modulesDir, dir, 'extension.json'), 'utf8'));
    } catch {
      continue;
    }
    if (!manifest || manifest.slug !== dir) continue;
    const disabled = await stat(join(modulesDir, dir, DISABLED_MARKER)).then(
      () => true,
      () => false,
    );
    found.set(dir, { manifest, disabled });
  }
  return found;
}

/** Writes or removes the marker. Only called for a slug that scanModules found, so no arbitrary path is reachable. */
export async function setModuleDisabled(
  modulesDir: string,
  slug: string,
  disabled: boolean,
): Promise<void> {
  if (!EXTENSION_SLUG_RE.test(slug)) throw new Error('invalid slug');
  const marker = join(modulesDir, slug, DISABLED_MARKER);
  if (disabled) await writeFile(marker, `${new Date().toISOString()}\n`);
  else await rm(marker, { force: true });
}
