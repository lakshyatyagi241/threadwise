import type { ConfigService } from '@nestjs/config';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

/**
 * Environment of the Google Sheets add-on (EXT). Read through ConfigService, which falls back to process.env for keys the shared schema
 * does not list, so the domain does not touch `env.schema.ts`. Everything is optional.
 */
const schema = z.object({
  APP_URL: z.string().url().default('http://localhost:3000'),
  /** Where the Apps Script source (Code.gs, Dialog.html, ...) is served from. Relative paths are taken from the working directory. */
  EXT_SHEETS_ADDON_DIR: z.string().trim().optional(),
  /** The add-on's page in the Google Workspace Marketplace, shown on the setup page. */
  EXT_SHEETS_MARKETPLACE_URL: z.string().url().default('https://workspace.google.com/marketplace/'),
});

export interface SheetsAddonEnv {
  /** The API origin the add-on calls, no trailing slash. */
  apiBase: string;
  /** Directories to look for the add-on source in, first that has the file wins. */
  sourceDirs: string[];
  marketplaceUrl: string;
}

const KEYS = Object.keys(schema.shape);
/** The folder the source is shipped in (apps/api/assets, copied next to the build by the Dockerfile). */
const DEFAULT_DIRS = ['assets/google-sheets-addon', 'apps/api/assets/google-sheets-addon'];

export function parseSheetsAddonEnv(
  raw: Record<string, string | undefined>,
  cwd: string = process.cwd(),
): SheetsAddonEnv {
  const parsed = schema.safeParse(
    Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== '')),
  );
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid Google Sheets add-on environment configuration:\n${details}\n`);
  }
  const e = parsed.data;
  const dirs = e.EXT_SHEETS_ADDON_DIR ? [e.EXT_SHEETS_ADDON_DIR] : DEFAULT_DIRS;
  return {
    apiBase: e.APP_URL.replace(/\/+$/, ''),
    sourceDirs: dirs.map((d) => (isAbsolute(d) ? d : resolve(cwd, d))),
    marketplaceUrl: e.EXT_SHEETS_MARKETPLACE_URL,
  };
}

export function readSheetsAddonEnv(config: ConfigService): SheetsAddonEnv {
  return parseSheetsAddonEnv(
    Object.fromEntries(KEYS.map((k) => [k, config.get<string>(k)])) as Record<
      string,
      string | undefined
    >,
  );
}
