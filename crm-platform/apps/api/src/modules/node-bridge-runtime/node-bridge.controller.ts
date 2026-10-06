import { Body, Controller, Get, HttpCode, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  nodeBridgeTestRequestSchema,
  updateNodeBridgeSchema,
  updateNodePacingSchema,
  updateUnofficialWhatsappSchema,
  type NodeBridgeTestRequest,
  type UpdateNodeBridgeInput,
  type UpdateNodePacingInput,
  type UpdateUnofficialWhatsappInput,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { NodeBridgeSettingsService } from './node-bridge-settings.service';

/**
 * The operator console's Node bridge panel (TW-NODE-052, 029). Reference gated it by "is an admin"; here every operator may
 * read, only a super admin saves or tests (the token authenticates every bridge call), and IP allowlist plus MFA come
 * from OperatorGuard.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/node-bridge', version: '2' })
export class NodeBridgeController {
  constructor(private readonly settings: NodeBridgeSettingsService) {}

  private operatorId(): number {
    return RequestContextStore.require().actorId!;
  }

  @Get()
  @ApiOperation({
    summary:
      'Bridge address, whether a token is saved, and the send pacing (the token is never returned)',
  })
  read() {
    return this.settings.read();
  }

  @Patch()
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Save the Server URL and token',
    description:
      'Requires the rowVersion you read. A blank token keeps the saved one. A blank URL clears the address.',
  })
  update(@Body(zodPipe(updateNodeBridgeSchema)) body: UpdateNodeBridgeInput) {
    return this.settings.updateBridge(body, this.operatorId());
  }

  @Patch('pacing')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Save the sender pacing and batching ("Update timing")' })
  updatePacing(@Body(zodPipe(updateNodePacingSchema)) body: UpdateNodePacingInput) {
    return this.settings.updatePacing(body, this.operatorId());
  }

  @Put('unofficial')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary:
      'Turn the unofficial WhatsApp engine (personal numbers over Baileys) on or off for the whole platform',
    description:
      'Off by default. Nothing is deleted either way: devices, broadcasts and channels stay and work again when it is turned on. Audited as platform.whatsapp_unofficial.updated.',
  })
  updateUnofficial(
    @Body(zodPipe(updateUnofficialWhatsappSchema)) body: UpdateUnofficialWhatsappInput,
  ) {
    return this.settings.updateUnofficial(body, this.operatorId());
  }

  @Post('test')
  @HttpCode(200)
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Test connection with the typed address and token (blank token = the saved one)',
    description:
      '422 for a non-http(s) address. Every other outcome is a 200 with ok true or false.',
  })
  test(@Body(zodPipe(nodeBridgeTestRequestSchema)) body: NodeBridgeTestRequest) {
    return this.settings.test(body);
  }
}
