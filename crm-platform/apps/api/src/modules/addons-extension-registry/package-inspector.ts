import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES, parseManifestText, type ExtensionManifest } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { compareVersions } from './version';
import { readEntry, readZip, ZipError, type ZipEntry } from './zip-reader';

export interface PackageInspection {
  manifest: ExtensionManifest;
  /** The wrapper folder holding extension.json ("" when it is at the root), with its trailing slash. */
  rootPrefix: string;
  entries: ZipEntry[];
}

const invalid = (message: string) =>
  new AppError(ERROR_CODES.ADD_PACKAGE_INVALID, message, HttpStatus.UNPROCESSABLE_ENTITY);

/** A ZIP starts with a local file header ("PK\3\4"); an empty archive with its end record ("PK\5\6"). */
export function looksLikeZip(buf: Buffer): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    (buf[2] === 0x03 || buf[2] === 0x05) &&
    (buf[3] === 0x04 || buf[3] === 0x06)
  );
}

/**
 * Opens the package read-only and validates it before a single byte is written (TW-ADD-004):
 *   - the archive must be readable
 *   - `extension.json` sits at the root, or inside exactly one wrapper folder (the first match wins)
 *   - the manifest parses and has a valid slug (the slug becomes a folder name, so it is validated, which Reference did not)
 *   - `min_core` must not be newer than the running core
 * Every refusal is a 422 with a message the upload banner can show.
 */
export function inspectPackage(
  buf: Buffer,
  opts: { coreVersion: string; maxEntries: number; maxUnpackedBytes: number },
): PackageInspection {
  let entries: ZipEntry[];
  try {
    if (!looksLikeZip(buf)) throw new ZipError('not a ZIP');
    entries = readZip(buf, { maxEntries: opts.maxEntries });
  } catch (err) {
    if (err instanceof ZipError && /entries/.test(err.message))
      throw invalid(`The package ${err.message}.`);
    throw invalid('The upload is not a readable ZIP archive.');
  }

  const declared = entries.reduce((sum, e) => sum + e.size, 0);
  if (declared > opts.maxUnpackedBytes) {
    throw new AppError(
      ERROR_CODES.ADD_PACKAGE_TOO_LARGE,
      'The package would unpack to more than the allowed size.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  const manifestEntry =
    entries.find((e) => !e.isDirectory && e.name === 'extension.json') ??
    entries.find((e) => !e.isDirectory && /^[^/]+\/extension\.json$/.test(e.name));
  if (!manifestEntry)
    throw invalid('This is not an extension package: extension.json was not found.');
  const rootPrefix = manifestEntry.name.slice(
    0,
    manifestEntry.name.length - 'extension.json'.length,
  );

  let text: string;
  try {
    text = readEntry(buf, manifestEntry).toString('utf8');
  } catch {
    throw invalid('The package is corrupt: extension.json could not be read.');
  }
  const manifest = parseManifestText(text);
  if (!manifest) {
    throw invalid(
      'The extension.json is malformed: it needs at least a slug of lowercase letters, digits, - or _ (64 characters at most).',
    );
  }
  if (manifest.minCore && compareVersions(opts.coreVersion, manifest.minCore) < 0) {
    throw new AppError(
      ERROR_CODES.ADD_CORE_TOO_OLD,
      `This add-on needs version ${manifest.minCore} or newer. This install is ${opts.coreVersion}. Update first, then add it.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return { manifest, rootPrefix, entries };
}
