import { Body, Controller, Get, Header, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  mailTestRequestSchema,
  setGroupSchema,
  setPatchSchemaFor,
  type MailTestRequest,
  type SetGroup,
  type SetPatchRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { ConnectionTestsService } from './connection-tests.service';
import { MailRuntimeService } from './mail-runtime.service';
import { SettingsService } from './settings.service';

/**
 * The operator console's settings surface (TW-SET-001..004, 024, 025, 039, 041). Reference gated all of it by
 * "is an admin" and never enforced its own permission; here every operator may read, only a super admin
 * writes, tests or exports, and IP allowlist plus MFA come from OperatorGuard.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/settings', version: '2' })
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly mail: MailRuntimeService,
    private readonly tests: ConnectionTestsService,
  ) {}

  private operatorId(): number {
    return RequestContextStore.require().actorId!;
  }

  @Get('groups')
  @ApiOperation({ summary: 'Settings hub: which groups are saved, what needs a test, key numbers' })
  hub() {
    return this.settings.hub();
  }

  @Get('groups/:group')
  @ApiOperation({
    summary: 'One settings group (secrets are never returned, only whether they are set)',
  })
  read(@Param('group', zodPipe(setGroupSchema)) group: SetGroup) {
    return this.settings.read(group);
  }

  @Patch('groups/:group')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary:
      'Partial update of one group. Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). ' +
      'Secrets go in `secrets`: blank keeps, null removes.',
  })
  patch(@Param('group', zodPipe(setGroupSchema)) group: SetGroup, @Body() raw: unknown) {
    const body = zodPipe(setPatchSchemaFor(group)).transform(raw) as SetPatchRequest;
    return this.settings.patch(group, body, this.operatorId());
  }

  @Get('export')
  @OperatorRoles('super_admin')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Every saved setting as JSON, secrets and account identifiers redacted',
  })
  export() {
    return this.settings.export(this.operatorId());
  }

  @Post('mail/test')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Send a test email with the saved mail settings' })
  async mailTest(@Body(zodPipe(mailTestRequestSchema)) body: MailTestRequest) {
    const result = await this.mail.test(body.to);
    await this.settings.recordTest('mail', result.ok, result.message, this.operatorId());
    return result;
  }

  @Post('storage/test')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Write and delete a probe object with the saved storage settings' })
  async storageTest() {
    const result = await this.tests.storageTest();
    await this.settings.recordTest('storage', result.ok, result.message, this.operatorId());
    return result;
  }

  @Post('realtime/test')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Fire a throwaway event at Pusher with the saved real-time settings' })
  async realtimeTest() {
    const result = await this.tests.realtimeTest();
    await this.settings.recordTest('realtime', result.ok, result.message, this.operatorId());
    return result;
  }
}
