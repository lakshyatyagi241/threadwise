import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { EXT_SHEETS_FILE_NAMES, type ExtSheetsFile, type ExtSheetsFileName } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { readSheetsAddonEnv } from '../../config/domains/chrome-extension-sheets-addon.env';

const FILES: Record<ExtSheetsFileName, { description: string; contentType: string }> = {
  'appsscript.json': {
    description: 'Manifest: the permissions the add-on asks Google for and where it appears.',
    contentType: 'application/json',
  },
  'Code.gs': {
    description: 'Server side of the add-on: the menu, reading the sheet and calling the API.',
    contentType: 'text/javascript',
  },
  'Dialog.html': {
    description: 'The sync window that opens inside the sheet.',
    contentType: 'text/html',
  },
  'Settings.html': {
    description: 'Where the member pastes, replaces or removes their key.',
    contentType: 'text/html',
  },
  'Help.html': { description: 'The help screen inside the add-on.', contentType: 'text/html' },
  'README.md': {
    description: 'How to put the files into a Google Apps Script project.',
    contentType: 'text/markdown',
  },
};

/** The constant in `Code.gs` that holds the API address; the served copy has it set to this installation. */
const BASE_CONSTANT = /const\s+CRM_BASE\s*=\s*(?:'[^']*'|"[^"]*");/;

const isKnown = (name: string): name is ExtSheetsFileName =>
  (EXT_SHEETS_FILE_NAMES as readonly string[]).includes(name);

/**
 * The add-on's source, served for download (TW-EXT-005). Until the Google Marketplace listing is live a member copies these files into
 * their own Apps Script project, so `Code.gs` is served with its API address already pointing at this installation. Only the six known
 * names are served, so a request cannot reach any other file (no path is ever built from the request).
 */
@Injectable()
export class SheetsFilesService {
  constructor(private readonly config: ConfigService) {}

  private env() {
    return readSheetsAddonEnv(this.config);
  }

  private async locate(name: ExtSheetsFileName): Promise<string | null> {
    for (const dir of this.env().sourceDirs) {
      const path = join(dir, name);
      try {
        if ((await stat(path)).isFile()) return path;
      } catch {
        // try the next directory
      }
    }
    return null;
  }

  async list(): Promise<ExtSheetsFile[]> {
    return Promise.all(
      EXT_SHEETS_FILE_NAMES.map(async (name) => {
        const path = await this.locate(name);
        const size = path ? (await stat(path)).size : 0;
        return {
          name,
          description: FILES[name].description,
          available: path !== null,
          sizeBytes: size,
          contentType: FILES[name].contentType,
        };
      }),
    );
  }

  async read(name: string): Promise<{ body: string; contentType: string; fileName: string }> {
    if (!isKnown(name)) throw AppError.notFound('File');
    const path = await this.locate(name);
    if (!path) throw AppError.notFound('File');
    let body = await readFile(path, 'utf8');
    if (name === 'Code.gs') {
      const base = this.env().apiBase.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      // A function replacer: the address must never be read as a `$1`-style pattern.
      body = body.replace(BASE_CONSTANT, () => `const CRM_BASE = '${base}';`);
    }
    return { body, contentType: FILES[name].contentType, fileName: name };
  }
}
