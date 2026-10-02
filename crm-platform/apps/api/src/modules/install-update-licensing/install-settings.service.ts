import { Injectable } from '@nestjs/common';
import { PlatformSettingsService } from '../auth';
import { NODE_BRIDGE_KEY, NODE_BRIDGE_TOKEN_KEY } from './setup.service';

export interface NodeBridgeSettings {
  serverUrl: string;
  port: number;
  token: string;
}

/**
 * Reader for what the install wizard saved that other domains consume (TW-INST-009, -011, -016).
 *
 * Reference wrote the Node bridge URL and shared token to `.env` and `node/.env` and kept the file in step with later
 * admin edits (EnvWriter). Here the platform settings are the only copy, so there is nothing to keep in step: the
 * Node bridge domain reads this one door, and an admin edit changes the same keys.
 */
@Injectable()
export class InstallSettingsService {
  constructor(private readonly settings: PlatformSettingsService) {}

  async nodeBridge(): Promise<NodeBridgeSettings | null> {
    const doc = await this.settings.get<{ serverUrl?: string; port?: number }>(NODE_BRIDGE_KEY);
    const token = await this.settings.getSecret(NODE_BRIDGE_TOKEN_KEY);
    if (!doc?.serverUrl || !doc.port || !token) return null;
    return { serverUrl: doc.serverUrl, port: doc.port, token };
  }
}
