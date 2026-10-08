import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** TW-ADD-024: the Settings hub's "Add-ons" button opens the code installer (/admin/extensions), not the billing packs. */
describe('settings hub add-ons button', () => {
  it('lands on the extensions page', () => {
    const src = readFileSync(
      join(__dirname, '../platform-settings-branding-storage/components/settings-hub.tsx'),
      'utf8',
    );
    expect(src).toMatch(/href="\/admin\/extensions"[^>]*>\s*\{tn\('actions\.addons'\)\}/);
  });
});
