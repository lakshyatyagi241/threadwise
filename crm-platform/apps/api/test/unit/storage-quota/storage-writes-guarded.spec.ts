import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE COVERAGE TEST of the storage quota (docs/specs/storage-quota-and-archival.md 6.4, wiring map
 * docs/threadwise-port/wiring/storage-quota.md): every place the API writes a file or a blob is either routed through the metering guard
 * (`common/storage-meter/storage-meter.port.ts`: `meteredWrite` / `reserveOn`, bound to `STORAGE_METER`) or listed here with the reason it
 * is not a workspace's counted storage.
 *
 * It fails when someone adds a writer and does not say which. That is the point: usage drifts the day a door is forgotten, and a quota
 * built on a count that misses a door is a quota with a hole in it. To fix a failure, route the new writer through the guard with a
 * category (`@crm/contracts` STORAGE_CATEGORIES) or add it to the table below with a real reason.
 *
 * Three scans: (1) calls that put an object on a store or a disk, (2) the Postgres blob tables (columns of type bytea), (3) the delete
 * path, which must give the bytes back. The legal-hold coverage test (`legal-hold-coverage.spec.ts`, branch lakshya/next/legal-hold) is the
 * sibling that lists the storage DELETION files; this one lists the WRITING files.
 */

const SRC = resolve(__dirname, '../../../src');
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');

type Role =
  /** Calls the guard itself (meteredWrite / reserveOn) and gives the bytes back on remove. */
  | 'door'
  /** Writes through a door; `via` names it. */
  | 'delegates'
  /** Not a workspace's counted storage (platform data, a primitive under a door, tooling): the reason says which. */
  | 'exempt'
  /** A known hole, recorded and counted. The list only gets shorter. */
  | 'gap';

interface Writer {
  role: Role;
  reason: string;
  /** For `delegates`: the door file (relative to src). */
  via?: string;
}

const CHAT_DOOR = 'infra/providers/chat-conversations/media/chat-media.store.ts';
const MEDIA_DOOR = 'modules/platform-settings-branding-storage/media-storage.service.ts';
const TRAINING_DOOR = 'infra/providers/ai-agents-training/local-training-file-store.adapter.ts';

/** Every file that puts an object on a store or writes a file to disk, by path relative to src. */
const WRITERS: Record<string, Writer> = {
  // --- the doors -------------------------------------------------------------------------------------------------------------
  [CHAT_DOOR]: {
    role: 'door',
    reason: 'ChatMediaStore: store, storeInbound, storeInboundStream (chat/<org>/...), local disk included',
  },
  [MEDIA_DOOR]: {
    role: 'door',
    reason: 'MediaStorageService.put: marketing/, scheduled/, telegram/, ai-training/ keys (chat/ is metered by ChatMediaStore)',
  },
  [TRAINING_DOOR]: {
    role: 'door',
    reason: 'the knowledge-file store (TRAINING_FILE_STORE): ai-training/<org>/...',
  },
  // --- callers that go through a door ------------------------------------------------------------------------------------------
  'modules/ai-agents-training/sources.service.ts': {
    role: 'delegates',
    reason: 'uploads a knowledge file through TRAINING_FILE_STORE',
    via: TRAINING_DOOR,
  },
  'modules/broadcasts/marketing-media.service.ts': {
    role: 'delegates',
    reason: 'MediaStorageService.put with a marketing/<org>/ key (campaign_media)',
    via: MEDIA_DOOR,
  },
  'modules/scheduled-queue-warmer/schedule-media.service.ts': {
    role: 'delegates',
    reason: 'MediaStorageService.put with a scheduled/<org>/ key (scheduled_media)',
    via: MEDIA_DOOR,
  },
  'modules/channel-telegram/_shims/storage-media-store.ts': {
    role: 'delegates',
    reason: 'MediaStorageService.put with a telegram/<org>/ key (channel_profile_media)',
    via: MEDIA_DOOR,
  },
  // --- primitives under a door ------------------------------------------------------------------------------------------------
  'infra/providers/chat-conversations/media/local-disk-media.store.ts': {
    role: 'exempt',
    reason: 'the local-disk primitive; only ChatMediaStore and the training store call it, and both are doors',
  },
  // --- not a workspace\'s counted storage (spec section 3) ---------------------------------------------------------------------
  'modules/marketing-site-cms/upload.service.ts': {
    role: 'exempt',
    reason: 'the platform marketing site\'s images (site/ keys carry no workspace): platform data, not a workspace\'s files',
  },
  'modules/data-retention/partition-archiver.service.ts': {
    role: 'exempt',
    reason: 'the platform event archive (S3_BUCKET_ARCHIVE): platform data, other bucket',
  },
  'infra/providers/data-retention/local-archive-storage.adapter.ts': {
    role: 'exempt',
    reason: 'local adapter of the platform event archive: platform data',
  },
  'infra/providers/data-retention/s3-archive-storage.adapter.ts': {
    role: 'exempt',
    reason: 'S3 adapter of the platform event archive: platform data',
  },
  'infra/providers/platform-settings-branding-storage/object-storage.probe.ts': {
    role: 'exempt',
    reason: 'the storage settings connection test: writes a probe object and deletes it at once',
  },
  'infra/net/s3-sigv4.ts': {
    role: 'exempt',
    reason: 'the request signer; it writes nothing itself',
  },
  'modules/platform-infrastructure/offsite-backup/offsite-backup.cli.ts': {
    role: 'exempt',
    reason: 'the platform\'s own off-host database backup tooling',
  },
  'modules/platform-infrastructure/offsite-backup/sync.ts': {
    role: 'exempt',
    reason: 'the platform\'s own off-host database backup upload',
  },
  'modules/platform-infrastructure/offsite-backup/s3-client.ts': {
    role: 'exempt',
    reason: 'the platform\'s own off-host backup client',
  },
  'modules/platform-infrastructure/offsite-backup/seal.ts': {
    role: 'exempt',
    reason: 'the platform\'s own off-host backup encryption',
  },
  'modules/addons-extension-registry/extension-installer.ts': {
    role: 'exempt',
    reason: 'installs platform extension code on the server\'s disk; not workspace content',
  },
  'modules/addons-extension-registry/module-loader.ts': {
    role: 'exempt',
    reason: 'writes a "disabled" marker file for a platform module',
  },
  'tools/emit-openapi.ts': {
    role: 'exempt',
    reason: 'a build-time tool that writes the OpenAPI document',
  },
  // --- known gaps (counted below; the list only gets shorter) -----------------------------------------------------------------
  'modules/flow-builder-editor/flow-media.service.ts': {
    role: 'gap',
    reason: 'flow builder media through FLOW_MEDIA_STORE (local-disk adapter, org uuid in the path): not metered in S1. Follow-up with the production adapter (phase S7)',
  },
  'infra/providers/flow-builder-editor/local-flow-media.adapter.ts': {
    role: 'gap',
    reason: 'the local-disk adapter behind FLOW_MEDIA_STORE (development and single-node installs). Same follow-up as flow-media.service.ts',
  },
  'modules/calling-voice/cli/demo-calls.ts': {
    role: 'gap',
    reason: 'a developer CLI that seeds demo recordings straight onto a store; the nightly reconcile and the backfill pick the files up. Never runs in production',
  },
};

/** The number of recorded gaps. Lowering it is the goal; raising it needs a review of why a new writer cannot use a door. */
const KNOWN_GAPS = 3;

/** The files that put an object on a store, write a file to disk or sign a write to a bucket (production code only). */
const OBJECT_PUT = /\b(?:gateway|storage|mediaStorage|media|files|fileStore|disk|local|store|archive|client|o\.client)\.(?:put|adopt|putFile|putBytes)\(/;
const FS_WRITE = /(?:^|[^.\w])(?:writeFile|writeFileSync|createWriteStream|appendFile|copyFile|copyFileSync)\(/;
const BUCKET_WRITE = /signS3Request\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const codeLines = (text: string): string[] =>
  text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));

const rel = (p: string): string => relative(SRC, p).split(sep).join('/');

describe('storage writes are guarded: object stores and disks', () => {
  const files = walk(SRC);
  const texts = new Map(files.map((f) => [rel(f), readFileSync(f, 'utf8')]));

  const writersFound = [...texts.entries()]
    .filter(([, text]) => codeLines(text).some((l) => OBJECT_PUT.test(l) || FS_WRITE.test(l) || BUCKET_WRITE.test(l)))
    .map(([file]) => file)
    .sort();

  it('every file that writes an object or a file is classified (route a new writer through the guard, or say why it is exempt)', () => {
    const unclassified = writersFound.filter((f) => !(f in WRITERS));
    expect(
      unclassified,
      'unclassified writers: send the bytes through a StorageMeter door (meteredWrite / reserveOn with a STORAGE_CATEGORIES kind) or add them to WRITERS with a reason',
    ).toEqual([]);
  });

  it('the classification has no stale entries', () => {
    const stale = Object.keys(WRITERS).filter((f) => !texts.has(f));
    expect(stale).toEqual([]);
  });

  it('every door calls the guard to reserve and to give the bytes back', () => {
    for (const [file, w] of Object.entries(WRITERS)) {
      if (w.role !== 'door') continue;
      const text = texts.get(file)!;
      expect(/meteredWrite\(|reserveOn\(/.test(text), `${file} reserves`).toBe(true);
      expect(text.includes('recordRemovedOn('), `${file} gives bytes back on remove`).toBe(true);
      expect(text.includes('STORAGE_METER'), `${file} injects the meter`).toBe(true);
    }
  });

  it('every caller that delegates names a real door', () => {
    for (const [file, w] of Object.entries(WRITERS)) {
      if (w.role !== 'delegates') continue;
      expect(w.via, `${file} names its door`).toBeDefined();
      expect(WRITERS[w.via!]?.role, `${file} -> ${w.via}`).toBe('door');
    }
  });

  it('an exemption states a real reason, not a shrug', () => {
    for (const [file, w] of Object.entries(WRITERS)) {
      if (w.role === 'exempt' || w.role === 'gap') {
        expect(w.reason.length, file).toBeGreaterThan(25);
      }
    }
  });

  it('the recorded gaps only go down', () => {
    const gaps = Object.values(WRITERS).filter((w) => w.role === 'gap').length;
    expect(gaps).toBeLessThanOrEqual(KNOWN_GAPS);
  });

  it('a bucket write is signed only by the media door, the connection test, the archives and the backup tooling', () => {
    const signers = writersFound.filter((f) => codeLines(texts.get(f)!).some((l) => BUCKET_WRITE.test(l)));
    for (const f of signers) expect(WRITERS[f]?.role, f).toMatch(/^(door|exempt)$/);
  });
});

describe('storage writes are guarded: Postgres blobs', () => {
  /** Tables with a bytea column, read from the migrations (and minus the tables later dropped). */
  function byteaTables(): string[] {
    const found = new Set<string>();
    const dropped = new Set<string>();
    for (const name of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
      const text = readFileSync(join(MIGRATIONS, name), 'utf8').replace(/--[^\n]*/g, '');
      for (const m of text.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\);/g)) {
        if (/\bbytea\b/i.test(m[2]!)) found.add(m[1]!);
      }
      for (const m of text.matchAll(/ALTER TABLE\s+(?:ONLY\s+)?(\w+)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?\w+\s+bytea/gi)) found.add(m[1]!);
      for (const m of text.matchAll(/DROP TABLE\s+(?:IF EXISTS\s+)?([\w,\s]+?)(?:CASCADE|;)/gi)) {
        for (const t of m[1]!.split(',')) dropped.add(t.trim());
      }
    }
    return [...found].filter((t) => !dropped.has(t)).sort();
  }

  /** How each table that holds bytes is accounted for. `metered` = the guard counts it; the rest follow spec section 3. */
  const BLOBS: Record<string, { how: 'metered' | 'exempt'; category: string; reason: string }> = {
    team_chat_attachment_blobs: {
      how: 'metered',
      category: 'team_chat_attachment',
      reason: 'MessagesService.post reserves and commits `pg:team_chat_attachment_blobs:<message id>` in the insert\'s transaction; the nightly check syncs the table',
    },
    order_proof_blobs: { how: 'exempt', category: 'payment_proof', reason: 'financial evidence tied to an order, 4 MB each' },
    user_avatars: { how: 'exempt', category: 'system_asset', reason: 'one slot per user, replaced in place' },
    workspace_brand_assets: { how: 'exempt', category: 'system_asset', reason: 'logo and favicon, one row per slot' },
    flow_widget_assets: { how: 'exempt', category: 'system_asset', reason: 'flow widget pictures, one row per slot' },
    revenue_report_exports: { how: 'exempt', category: 'temporary_export', reason: 'temporary (7 days), one at a time' },
    message_log_exports: { how: 'exempt', category: 'temporary_export', reason: 'temporary (7 days), one at a time' },
    contact_consent_exports: { how: 'exempt', category: 'temporary_export', reason: 'temporary, a compliance duty' },
    audit_log_exports: { how: 'exempt', category: 'temporary_export', reason: 'temporary, a compliance duty' },
    contact_exports: { how: 'exempt', category: 'temporary_export', reason: 'temporary saved contact exports' },
    privacy_request_exports: { how: 'exempt', category: 'privacy_export', reason: 'a legal duty to deliver (GDPR Art. 15/20): must work at 100% full' },
    message_event_archives: { how: 'exempt', category: 'system_asset', reason: 'platform data (the message log archive), not the workspace\'s files' },
    webhook_forward_failures: { how: 'exempt', category: 'system_asset', reason: 'platform operating data (retried webhook bodies)' },
    webauthn_credentials: { how: 'exempt', category: 'system_asset', reason: 'a public key, not a file' },
    platform_webauthn_credentials: { how: 'exempt', category: 'system_asset', reason: 'a public key, not a file (platform operators)' },
  };

  it('every table with a bytea column is classified: metered, or one of the kinds spec section 3 leaves out', () => {
    const tables = byteaTables();
    expect(tables.length).toBeGreaterThan(5);
    const unclassified = tables.filter((t) => !(t in BLOBS));
    expect(
      unclassified,
      'a new blob table: meter it (StorageMeter, a STORAGE_CATEGORIES kind) or classify it in BLOBS with the spec section 3 reason',
    ).toEqual([]);
  });

  it('the metered blob table is really metered by its writer', () => {
    const post = readFileSync(join(SRC, 'modules/team-chat/messages.service.ts'), 'utf8');
    expect(post).toContain('STORAGE_METER');
    expect(post).toContain("category: 'team_chat_attachment'");
    expect(post).toContain('teamChatBlobKey(');
    // the insert itself is in the repository, called only from the metered path
    const repo = readFileSync(join(SRC, 'modules/team-chat/team-chat.repository.ts'), 'utf8');
    expect(repo.match(/INSERT INTO team_chat_attachment_blobs/g)).toHaveLength(1);
    const callers = [...walk(SRC)].filter((f) => readFileSync(f, 'utf8').includes('insertAttachmentBlob('));
    expect(callers.map(rel).sort()).toEqual([
      'modules/team-chat/messages.service.ts',
      'modules/team-chat/team-chat.repository.ts',
    ]);
  });

  it('every exempt kind names a category the contract does not count', async () => {
    const { STORAGE_CATEGORY_DEFS } = await import('@crm/contracts');
    for (const [table, b] of Object.entries(BLOBS)) {
      if (b.how !== 'exempt') continue;
      const def = STORAGE_CATEGORY_DEFS[b.category as keyof typeof STORAGE_CATEGORY_DEFS];
      expect(def, table).toBeDefined();
      expect(def.counted, `${table} is exempt as ${b.category}`).toBe(false);
    }
  });
});
