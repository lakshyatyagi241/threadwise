import { mkdir, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import type { PackageInspection } from './package-inspector';
import { readEntryAsync } from './zip-reader';

/**
 * Paths a package may never write or have removed, relative to the module folder (TW-ADD-005 rule 3). Everything
 * lands under `<modulesDir>/<slug>/`, so this mostly guards odd layouts; `.disabled` is the activation marker, which
 * a package must not be able to plant.
 */
const PROTECTED = [
  '.env',
  'composer.json',
  'composer.lock',
  'config/license.php',
  'config/license.json',
  'config/version.php',
  'storage',
  'vendor',
  'node_modules',
  '.disabled',
];

export function isProtectedPath(rel: string): boolean {
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  if (/^\.env(\.|$)/.test(p)) return true;
  return PROTECTED.some((x) => p === x || p.startsWith(`${x}/`));
}

/** A package path that stays inside its folder: relative, no `..`, no drive letter, no NUL. */
export function isSafeRelative(rel: string): boolean {
  if (!rel || rel.includes('\0') || rel.includes('\\')) return false;
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return false;
  return !rel.split('/').includes('..');
}

export interface InstallResult {
  /** Paths relative to the modules directory (`<slug>/...`), the list uninstall removes. */
  files: string[];
  written: number;
  skipped: number;
}

/**
 * Extracts the inspected package under `<modulesDir>/<slug>/`, never anywhere else (TW-ADD-005). Entries that climb
 * out (`..`), are absolute, or hit a protected path are skipped and counted; `extension.json` is always written
 * because discovery depends on it. On any failure the files this call wrote are removed again.
 */
export async function installPackage(
  buf: Buffer,
  inspection: PackageInspection,
  modulesDir: string,
): Promise<InstallResult> {
  const { manifest, rootPrefix, entries } = inspection;
  const root = resolve(modulesDir, manifest.slug);
  const files: string[] = [];
  let skipped = 0;

  try {
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      if (rootPrefix && !entry.name.startsWith(rootPrefix)) {
        skipped++; // outside the wrapper folder: not part of the package
        continue;
      }
      const rel = entry.name.slice(rootPrefix.length);
      if (!isSafeRelative(rel) || (rel !== 'extension.json' && isProtectedPath(rel))) {
        skipped++;
        continue;
      }
      const target = resolve(root, rel);
      if (!target.startsWith(root + sep)) {
        skipped++; // belt and braces: whatever the checks above missed, the resolved path decides
        continue;
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readEntryAsync(buf, entry));
      files.push(`${manifest.slug}/${rel}`);
    }
  } catch (err) {
    await removeFiles(modulesDir, files);
    throw err;
  }

  if (files.length === 0) {
    throw new AppError(
      ERROR_CODES.ADD_PACKAGE_INVALID,
      'The ZIP contained no installable files.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return { files, written: files.length, skipped };
}

/**
 * Removes exactly the tracked files (TW-ADD-008): a path that climbs out or is protected is ignored, hand-added
 * files are never swept, and folders left empty are pruned upward, stopping at the first non-empty one and never at
 * or above the modules directory. Returns how many files were deleted.
 */
export async function removeFiles(modulesDir: string, tracked: string[]): Promise<number> {
  const base = resolve(modulesDir);
  let removed = 0;
  const dirs = new Set<string>();
  for (const path of tracked) {
    if (!isSafeRelative(path)) continue;
    const [, ...rest] = path.split('/');
    if (rest.length > 0 && rest.join('/') !== 'extension.json' && isProtectedPath(rest.join('/')))
      continue;
    const target = resolve(base, path);
    if (!target.startsWith(base + sep)) continue;
    try {
      await rm(target, { force: false });
      removed++;
    } catch {
      continue; // already gone
    }
    dirs.add(dirname(target));
  }
  for (const start of [...dirs].sort((a, b) => b.length - a.length)) {
    let dir = start;
    while (dir.startsWith(base + sep)) {
      try {
        if ((await readdir(dir)).length > 0) break;
        await rmdir(dir); // refuses a non-empty folder, so it can never take a stranger's files
      } catch {
        break;
      }
      dir = join(dir, '..');
    }
  }
  return removed;
}
