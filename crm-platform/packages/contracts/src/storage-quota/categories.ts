/**
 * The closed list of what a workspace's storage is made of (spec docs/specs/storage-quota-and-archival.md sections 3 and 6.1).
 *
 * Every file kind that is written names one of these; a new file feature that cannot name its kind does not get past the coverage test
 * (`apps/api/test/unit/storage-quota/storage-writes-guarded.spec.ts`). The behaviour of a kind is data in `STORAGE_CATEGORY_DEFS`, not
 * an `if` at a call site: who put the file there (`origin`), what happens at the limit (`policy`), and whether it counts at all.
 */

export const STORAGE_CATEGORIES = [
  /** A call recording (`wa_calls.recording_path`). The largest single file kind. */
  'call_recording',
  /** A file an agent, a widget visitor, the developer API or a flow put into a conversation. */
  'inbox_media',
  /** A file a customer sent (WhatsApp, Telegram, Viber, LINE, Facebook, Instagram, WeChat, QR). Cannot be refused: grace, then metadata only. */
  'inbox_media_inbound',
  /** An attachment or inline image of a received email. Cannot be refused either. */
  'email_attachment_inbound',
  /** An attachment staged in the composer, freed by the expiry sweep. */
  'email_attachment_staged',
  /** The object a contact file row points at, counted once per object key. */
  'contact_file',
  /** A file attached to a scheduled message. */
  'scheduled_media',
  /** A file attached to a broadcast or campaign. */
  'campaign_media',
  /** A knowledge-base file of an AI assistant. */
  'ai_training_file',
  /** A team chat attachment (a Postgres blob today, counted by `byte_size`). */
  'team_chat_attachment',
  /** A contact's profile picture fetched from a channel (Telegram). */
  'channel_profile_media',
  /** An object found in the bucket that no registry row names: adopted by the weekly bucket verify (phase S5), owned by nobody yet. */
  'unknown',
  // --- not counted: listed so the closed list is complete and the screen can show them "for sight" (section 3) ---
  /** Report and data exports (revenue, message log, consent, audit, contacts): temporary, a compliance duty. */
  'temporary_export',
  /** The data-subject request export (GDPR Art. 15/20): must work at 100% full. */
  'privacy_export',
  /** Avatars, workspace logo and favicon, flow widget pictures: one slot each, replaced in place. */
  'system_asset',
  /** Order payment proof images: financial evidence tied to an order. */
  'payment_proof',
] as const;
export type StorageCategory = (typeof STORAGE_CATEGORIES)[number];

/** Who caused the file to be stored. A customer's file cannot be refused; an agent's can. */
export const STORAGE_ORIGINS = ['agent', 'customer', 'system'] as const;
export type StorageOrigin = (typeof STORAGE_ORIGINS)[number];

/**
 * What happens to a NEW file of the kind when the workspace is at its limit (enforce mode only; phases S0 and S1 never refuse):
 *  - `block`: refused with 422 STORAGE_QUOTA_EXCEEDED;
 *  - `grace_then_metadata_only`: stored inside the inbound grace allowance, then only the message and its metadata are kept;
 *  - `never`: never refused (system files, adopted objects).
 */
export const STORAGE_POLICIES = ['block', 'grace_then_metadata_only', 'never'] as const;
export type StoragePolicy = (typeof STORAGE_POLICIES)[number];

export interface StorageCategoryDef {
  origin: StorageOrigin;
  policy: StoragePolicy;
  /** Whether its bytes count toward the quota. */
  counted: boolean;
}

export const STORAGE_CATEGORY_DEFS = {
  call_recording: { origin: 'agent', policy: 'block', counted: true },
  inbox_media: { origin: 'agent', policy: 'block', counted: true },
  inbox_media_inbound: { origin: 'customer', policy: 'grace_then_metadata_only', counted: true },
  email_attachment_inbound: {
    origin: 'customer',
    policy: 'grace_then_metadata_only',
    counted: true,
  },
  email_attachment_staged: { origin: 'agent', policy: 'block', counted: true },
  contact_file: { origin: 'agent', policy: 'block', counted: true },
  scheduled_media: { origin: 'agent', policy: 'block', counted: true },
  campaign_media: { origin: 'agent', policy: 'block', counted: true },
  ai_training_file: { origin: 'agent', policy: 'block', counted: true },
  team_chat_attachment: { origin: 'agent', policy: 'block', counted: true },
  channel_profile_media: {
    origin: 'customer',
    policy: 'grace_then_metadata_only',
    counted: true,
  },
  unknown: { origin: 'system', policy: 'never', counted: true },
  temporary_export: { origin: 'system', policy: 'never', counted: false },
  privacy_export: { origin: 'system', policy: 'never', counted: false },
  system_asset: { origin: 'system', policy: 'never', counted: false },
  payment_proof: { origin: 'system', policy: 'never', counted: false },
} as const satisfies Record<StorageCategory, StorageCategoryDef>;

/** The categories whose bytes count toward the quota. */
export const COUNTED_STORAGE_CATEGORIES: readonly StorageCategory[] = STORAGE_CATEGORIES.filter(
  (c) => STORAGE_CATEGORY_DEFS[c].counted,
);

export const isCountedStorageCategory = (c: StorageCategory): boolean =>
  STORAGE_CATEGORY_DEFS[c].counted;

/** hot: in the bucket in use; cold: moved to the cold tier (phase S5); restored: a hot copy of a cold file for a window. */
export const STORAGE_TIERS = ['hot', 'cold', 'restored'] as const;
export type StorageTier = (typeof STORAGE_TIERS)[number];

/** pending: written but not yet linked to its owner row (an hour later it is an orphan); live: linked; missing: the bucket no longer has it. */
export const STORAGE_OBJECT_STATES = ['pending', 'live', 'missing'] as const;
export type StorageObjectState = (typeof STORAGE_OBJECT_STATES)[number];

/** Where a workspace stands against its cap (section 7.1). Phases S0 and S1 compute it for display only. */
export const STORAGE_LEVELS = ['ok', 'warn80', 'full', 'over'] as const;
export type StorageLevel = (typeof STORAGE_LEVELS)[number];

/**
 * How the guard behaves, per platform (`platform_settings` key `storage.quota.mode`) and, later, per workspace:
 *  - `off`: the guard is dormant, nothing is registered;
 *  - `observe`: every write is measured and recorded, NOTHING is ever refused (the default);
 *  - `enforce`: counted writes are refused at the limit. Not built yet (phase S2): a build that finds this value behaves as `observe`.
 */
export const STORAGE_MODES = ['off', 'observe', 'enforce'] as const;
export type StorageMode = (typeof STORAGE_MODES)[number];

/** The platform setting that holds the mode. A missing row means `observe`. */
export const STORAGE_MODE_SETTING_KEY = 'storage.quota.mode';

/** 1 GB = 2^30 bytes. The plan limit `storage_gb` is whole GB; bytes are the unit everywhere inside the system. */
export const BYTES_PER_GB = 1024 * 1024 * 1024;

/** Where a level starts, as a share of the cap (section 7.1). */
export const STORAGE_WARN_RATIO = 0.8;
