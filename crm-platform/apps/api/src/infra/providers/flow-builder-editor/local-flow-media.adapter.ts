import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '../../../config/env.schema';
import type { FlowMediaStore, StoredFlowMedia } from './flow-media.port';

const SAFE = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_NAME = /^\d{6,}_[a-f0-9]{24}\.[a-z0-9]{1,5}$/;

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  tiff: 'image/tiff', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', '3gp': 'video/3gpp',
  mkv: 'video/x-matroska', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
  wav: 'audio/wav', amr: 'audio/amr', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
};

/**
 * Local-disk store for flow media. Files live under `FLB_MEDIA_DIR` (default: a folder in the OS temp dir) at
 * `<org key>/<server name>`; both path parts are validated against a strict pattern so a request can never reach outside.
 * Development and single-node deployments only: production binds an object-storage adapter to FLOW_MEDIA_STORE.
 */
@Injectable()
export class LocalFlowMediaAdapter implements FlowMediaStore {
  private readonly dir = process.env.FLB_MEDIA_DIR || join(tmpdir(), 'crm-flow-media');

  constructor(private readonly config: ConfigService<Env, true>) {}

  async put(orgKey: string, name: string, data: Buffer): Promise<StoredFlowMedia> {
    if (!SAFE.test(orgKey) || !SAFE_NAME.test(name)) throw new Error('unsafe media path');
    await mkdir(join(this.dir, orgKey), { recursive: true });
    await writeFile(join(this.dir, orgKey, name), data, { flag: 'wx' });
    const base = String(this.config.get('APP_URL', { infer: true })).replace(/\/$/, '');
    return { url: `${base}/v2/flow-media/${orgKey}/${name}` };
  }

  async get(orgKey: string, name: string): Promise<{ data: Buffer; mime: string } | null> {
    if (!SAFE.test(orgKey) || !SAFE_NAME.test(name)) return null;
    try {
      const data = await readFile(join(this.dir, orgKey, name));
      const ext = name.split('.').pop() ?? '';
      return { data, mime: MIME[ext] ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  }
}
