import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSheetsAddonEnv } from '../../../src/config/domains/chrome-extension-sheets-addon.env';
import { SheetsFilesService } from '../../../src/modules/chrome-extension-sheets-addon/sheets-files.service';
import {
  SHEETS_PATH_PREFIX,
  toSheetsError,
} from '../../../src/modules/chrome-extension-sheets-addon/sheets-error-renderer';

let dir: string;
const service = (env: Record<string, string>) =>
  new SheetsFilesService(new ConfigService(env) as ConfigService);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sheets-addon-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** TW-EXT-005: the add-on source download. */
describe('add-on source files', () => {
  it('serves Code.gs with the API address of this installation, and every other file untouched', async () => {
    writeFileSync(
      join(dir, 'Code.gs'),
      "// head\nconst CRM_BASE = 'https://old.example';\nfunction x() { return CRM_BASE; }\n",
    );
    writeFileSync(join(dir, 'Help.html'), "<p>const CRM_BASE = 'https://old.example';</p>");
    const s = service({ EXT_SHEETS_ADDON_DIR: dir, APP_URL: 'https://api.mine.test/' });
    const code = await s.read('Code.gs');
    expect(code.body).toContain("const CRM_BASE = 'https://api.mine.test';");
    expect(code.body).not.toContain('old.example');
    expect(code.body).toContain('function x() { return CRM_BASE; }');
    expect(code.contentType).toBe('text/javascript');
    expect((await s.read('Help.html')).body).toContain('old.example');
  });

  it('writes an address that looks like a replacement pattern literally', async () => {
    writeFileSync(join(dir, 'Code.gs'), "const CRM_BASE = '';\n");
    const s = service({ EXT_SHEETS_ADDON_DIR: dir, APP_URL: "https://a.test/$&?x='1" });
    expect((await s.read('Code.gs')).body).toContain("https://a.test/$&?x=\\'1");
  });

  it('serves only the six known names, never a path', async () => {
    writeFileSync(join(dir, 'secret.txt'), 'x');
    mkdirSync(join(dir, 'sub'));
    const s = service({ EXT_SHEETS_ADDON_DIR: dir });
    for (const bad of [
      'secret.txt',
      '../secret.txt',
      'sub',
      '..%2F..%2Fetc%2Fpasswd',
      'code.gs',
      '',
    ]) {
      await expect(s.read(bad), bad).rejects.toMatchObject({ status: 404 });
    }
  });

  it('lists each file with whether it is on the server and how big it is', async () => {
    writeFileSync(join(dir, 'Code.gs'), '12345');
    const list = await service({ EXT_SHEETS_ADDON_DIR: dir }).list();
    expect(list.map((f) => f.name)).toEqual([
      'Code.gs',
      'Dialog.html',
      'Settings.html',
      'Help.html',
      'appsscript.json',
      'README.md',
    ]);
    expect(list[0]).toMatchObject({ available: true, sizeBytes: 5 });
    expect(list[1]).toMatchObject({ available: false, sizeBytes: 0 });
    await expect(service({ EXT_SHEETS_ADDON_DIR: dir }).read('Dialog.html')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('looks in the shipped folders when no directory is configured, and refuses a bad address', () => {
    // The source resolves relative folders with the platform's path rules (drive-letter paths on Windows), so expect the same.
    expect(parseSheetsAddonEnv({}, '/app').sourceDirs).toEqual([
      resolve('/app', 'assets/google-sheets-addon'),
      resolve('/app', 'apps/api/assets/google-sheets-addon'),
    ]);
    expect(parseSheetsAddonEnv({ EXT_SHEETS_ADDON_DIR: '/x' }, '/app').sourceDirs).toEqual(['/x']);
    expect(parseSheetsAddonEnv({ APP_URL: 'https://a.test///' }).apiBase).toBe('https://a.test');
    expect(() => parseSheetsAddonEnv({ APP_URL: 'nope' })).toThrow(/APP_URL/);
  });
});

describe('the add-on error envelope', () => {
  it('answers ok:false with the sentence, the stable code and field errors by name', () => {
    expect(SHEETS_PATH_PREFIX).toBe('/api/v1/sheets-addon');
    expect(
      toSheetsError({
        type: 't',
        title: 'Unprocessable',
        status: 422,
        detail: 'Request payload failed validation',
        code: 'VALIDATION_FAILED',
        requestId: 'r1',
        errors: [
          { path: 'shop_name', message: 'The shop name is required' },
          { path: 'shop_name', message: 'Too short' },
        ],
      }),
    ).toEqual({
      ok: false,
      error: 'Request payload failed validation',
      code: 'VALIDATION_FAILED',
      details: { shop_name: ['The shop name is required', 'Too short'] },
      requestId: 'r1',
    });
    expect(
      toSheetsError({ type: 't', title: 'Nope', status: 401, code: 'EXT_KEY_INVALID' }),
    ).toEqual({
      ok: false,
      error: 'Nope',
      code: 'EXT_KEY_INVALID',
    });
  });
});
