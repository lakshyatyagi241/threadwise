import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createAdminFlowTemplateSchema,
  listAdminFlowTemplatesQuerySchema,
  updateAdminFlowTemplateSchema,
  uuidSchema,
  type CreateAdminFlowTemplateInput,
  type ListAdminFlowTemplatesQuery,
  type UpdateAdminFlowTemplateInput,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { FlowTemplatesAdminService } from './flow-templates-admin.service';

/**
 * The starter-template catalogue for platform operators (WD-FLB-011, 012). Every operator role reads; only super admins
 * write, and every write is recorded as a security event.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/flow-templates', version: '2' })
export class PlatformFlowTemplatesController {
  constructor(private readonly templates: FlowTemplatesAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Templates (20 per page) with the three stat tiles' })
  async list(
    @Query(zodPipe(listAdminFlowTemplatesQuerySchema)) query: ListAdminFlowTemplatesQuery,
  ) {
    return this.templates.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One template with its graph (the edit form)' })
  async one(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.templates.get(id);
  }

  @Post()
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Create a template from an uploaded or pasted export, or by cloning a flow',
    description:
      '422 FLB_TEMPLATE_GRAPH_REQUIRED when none of the three sources is given; 422 FLB_IMPORT_INVALID when it has no flowNodes.',
  })
  async create(@Body(zodPipe(createAdminFlowTemplateSchema)) body: CreateAdminFlowTemplateInput) {
    return this.templates.create(body);
  }

  @Put(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Edit a template; leave the graph sources empty to keep the current flow',
  })
  async update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateAdminFlowTemplateSchema)) body: UpdateAdminFlowTemplateInput,
  ) {
    return this.templates.update(id, body);
  }

  @Post(':id/toggle')
  @HttpCode(HttpStatus.OK)
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Show or hide a template for tenants' })
  async toggle(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.templates.toggle(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Delete a template (tenants who cloned it keep their copy)' })
  async remove(@Param('id', zodPipe(uuidSchema)) id: string) {
    await this.templates.remove(id);
  }
}
