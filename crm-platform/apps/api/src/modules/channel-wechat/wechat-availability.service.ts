import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, type WechatAvailability } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { ChannelsRepository } from './channels.repository';
import { wechatAllowedIn, workspaceCountry } from './wechat-rules';

/**
 * Whether this workspace may use WeChat at all, by its country (WeChat is banned in India). One rule for every entry point:
 * connecting a channel, creating or starting a broadcast, sending a reply, and the list the screens read.
 */
@Injectable()
export class WechatAvailabilityService {
  constructor(private readonly repo: ChannelsRepository) {}

  async forOrg(tx: Tx, orgId: number): Promise<WechatAvailability> {
    const { billing, onboarding } = await this.repo.orgCountries(tx, orgId);
    const country = workspaceCountry(billing, onboarding);
    return { available: wechatAllowedIn(country), country };
  }

  /** The refusal every WeChat entry point answers with while the workspace's country blocks it. */
  static refused(): AppError {
    return new AppError(
      ERROR_CODES.WECH_CHANNEL_UNAVAILABLE,
      'WeChat is not available in your country.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
