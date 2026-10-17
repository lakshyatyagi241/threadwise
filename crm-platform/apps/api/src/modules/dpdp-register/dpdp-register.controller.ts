import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  DPDP_ATTESTABLE_CHECKS,
  dpdpAttestInputSchema,
  type DpdpAttestInput,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { DpdpRegisterService } from './dpdp-register.service';

/** The `:key` of a route: one of the checks a super admin can attest. Any other key (a live or code check, a typo) is a 422. */
const attestableKeySchema = z.enum(DPDP_ATTESTABLE_CHECKS);

/**
 * The DPDP compliance register of the super admin console: which obligations of the Act and the Rules the platform follows today.
 * Every operator role can read it; only a super admin can record an attestation.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/dpdp-register', version: '2' })
export class DpdpRegisterController {
  constructor(private readonly register: DpdpRegisterService) {}

  @Get()
  @OperatorRoles('super_admin', 'support', 'auditor')
  @ApiOperation({
    summary:
      'The DPDP register: milestones, the summary, and every obligation with its status and checks',
  })
  get() {
    return this.register.get();
  }

  @Get('checks/:key/history')
  @OperatorRoles('super_admin', 'support', 'auditor')
  @ApiOperation({
    summary: 'The attestations recorded for one check, newest first, with who and when',
  })
  history(@Param('key', zodPipe(attestableKeySchema)) key: string) {
    return this.register.history(key);
  }

  @Post('checks/:key/attest')
  @HttpCode(HttpStatus.OK)
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Record that a check passes or fails, with a note and an expiry; returns the register',
  })
  attest(
    @Param('key', zodPipe(attestableKeySchema)) key: string,
    @Body(zodPipe(dpdpAttestInputSchema)) body: DpdpAttestInput,
  ) {
    return this.register.attest(key, body);
  }
}
