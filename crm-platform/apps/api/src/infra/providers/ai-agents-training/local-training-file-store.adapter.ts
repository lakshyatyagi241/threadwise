import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { chatMediaConfig, isSafeMediaKey, LocalDiskMediaStore } from '../chat-conversations/media';
import type { TrainingFileStore } from './training-file-store.port';

const EXT = /^[a-z0-9]{1,8}$/;

/**
 * Local-disk store for knowledge files, under the same root as chat media (`MEDIA_LOCAL_DIR`) in its own `ai-training/<org>/`
 * folder. Development and single-node installs; production binds an object-storage adapter to TRAINING_FILE_STORE.
 */
@Injectable()
export class LocalTrainingFileStore implements TrainingFileStore {
  private readonly disk = new LocalDiskMediaStore(chatMediaConfig().localDir);

  private static prefix(orgId: number): string {
    return `ai-training/${orgId}/`;
  }

  private owns(orgId: number, key: string): boolean {
    return key.startsWith(LocalTrainingFileStore.prefix(orgId)) && isSafeMediaKey(key);
  }

  async put(orgId: number, ext: string, data: Buffer): Promise<string> {
    if (!EXT.test(ext)) throw new Error('unsafe file extension');
    const key = `${LocalTrainingFileStore.prefix(orgId)}${randomBytes(16).toString('hex')}.${ext}`;
    await this.disk.put(key, data);
    return key;
  }

  async copy(orgId: number, key: string): Promise<string | null> {
    if (!this.owns(orgId, key)) return null;
    const opened = await this.disk.open(key);
    if (!opened) return null;
    const chunks: Buffer[] = [];
    for await (const c of opened.stream) chunks.push(c as Buffer);
    const ext = key.split('.').pop() ?? 'bin';
    return this.put(orgId, ext, Buffer.concat(chunks));
  }

  async remove(orgId: number, key: string): Promise<void> {
    if (!this.owns(orgId, key)) return;
    await this.disk.remove(key);
  }
}
