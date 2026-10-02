import { Inject, Injectable } from '@nestjs/common';
import type { ReleaseInfo } from '@crm/contracts';
import { INST_ENV, type InstEnv } from '../../config/domains/install-update-licensing.env';
import { buildReleaseInfo } from './release-info';

/** Version, build and git sha of the running image (WD-INST-027), computed once. */
@Injectable()
export class ReleaseInfoService {
  readonly info: ReleaseInfo;

  constructor(@Inject(INST_ENV) env: InstEnv) {
    const nodeEnv = process.env.NODE_ENV;
    this.info = buildReleaseInfo(
      env,
      nodeEnv === 'production' || nodeEnv === 'test' ? nodeEnv : 'development',
    );
  }
}
