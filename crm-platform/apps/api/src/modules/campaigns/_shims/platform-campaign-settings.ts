import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../platform-settings-branding-storage';
import type { CampaignSettings, CampaignSettingsSource } from './tokens';

/** The operator's campaign rules (`/admin/settings/campaigns`): retries, the wait between them, and the automatic end. */
@Injectable()
export class PlatformCampaignSettings implements CampaignSettingsSource {
  constructor(private readonly settings: SettingsService) {}

  async get(): Promise<CampaignSettings> {
    return this.settings.values('campaigns');
  }
}
