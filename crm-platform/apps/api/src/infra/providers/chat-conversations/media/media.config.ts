import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const MIB = 1024 * 1024;

/**
 * Settings of the chat media store. Read straight from the environment (the central schema belongs to the kernel) and validated
 * once; every value has a safe default so a fresh checkout runs.
 *
 * The size limits are WhatsApp's own, so a file we accept is a file the channel will carry: 5 MB images, 16 MB audio and video,
 * 100 MB documents.
 */
const schema = z.object({
  /**
   * Where media lives when no cloud bucket is configured (dev, tests, small self-hosted installs). Outside the repository on
   * purpose: uploaded customer files must never end up in a commit or a Docker build context.
   */
  MEDIA_LOCAL_DIR: z.string().min(1).optional(),
  MEDIA_MAX_BYTES_IMAGE: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * MIB),
  MEDIA_MAX_BYTES_MEDIA: z.coerce
    .number()
    .int()
    .positive()
    .default(16 * MIB),
  MEDIA_MAX_BYTES_DOCUMENT: z.coerce
    .number()
    .int()
    .positive()
    .default(100 * MIB),
  /** How long a media link works. Short: the link is minted when a thread is read, not stored. */
  MEDIA_TOKEN_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
});

export interface ChatMediaConfig {
  localDir: string;
  maxBytes: { image: number; media: number; document: number };
  tokenTtlSeconds: number;
}

/** Read at call time so tests can change the environment between runs. */
export function chatMediaConfig(env: NodeJS.ProcessEnv = process.env): ChatMediaConfig {
  const v = schema.parse(env);
  return {
    localDir: resolve(v.MEDIA_LOCAL_DIR ?? join(homedir(), '.crm-platform', 'media')),
    maxBytes: {
      image: v.MEDIA_MAX_BYTES_IMAGE,
      media: v.MEDIA_MAX_BYTES_MEDIA,
      document: v.MEDIA_MAX_BYTES_DOCUMENT,
    },
    tokenTtlSeconds: v.MEDIA_TOKEN_TTL_SECONDS,
  };
}
