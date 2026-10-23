import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The runtime reads a published flow from its copies (2028 and 2029 migrations). The migration arms live flows and must fill those copies
 * the way the app's publish path does, or a saved edit or a typed keyword goes live before Publish. Read as text: the statements need a DB.
 */
const flowstate = readFileSync(join(__dirname, '../load/flowstate.ts'), 'utf8');
const cutover = readFileSync(join(__dirname, '../load/cutover.ts'), 'utf8');
const COPIES = [
  'published_flow_data = flow_data',
  'published_trigger_kind = trigger_kind',
  'published_trigger_value = trigger_value',
  'published_trigger_keywords = trigger_keywords',
  'published_trigger_config = trigger_config',
  'published_trigger_device_id = trigger_device_id',
  'published_trigger_channel_id = trigger_channel_id',
  'published_provider = provider',
];

// A text check: it reads the SQL, it does not run it. A wrong column or a missing WHERE clause would still pass here.
describe('flow go-live copies the draft into the published copies (text check of load/flowstate.ts)', () => {
  it('the arming statement copies the draft and its trigger settings', () => {
    for (const c of COPIES) expect(flowstate, c).toContain(c);
  });

  it('live flows armed by an earlier run are backfilled when they have no copy', () => {
    expect(flowstate).toContain('AND is_published AND published_flow_data IS NULL');
  });

  it('the rollback clears the published graph copy, as Unpublish does', () => {
    expect(cutover).toContain('published_at = NULL, published_flow_data = NULL');
  });
});
