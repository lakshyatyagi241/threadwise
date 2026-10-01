import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createAttributeSchema,
  deleteAttributeQuerySchema,
  listAttributesQuerySchema,
  resolveMergeTagSchema,
  updateAttributeSchema,
  type CreateAttributeInput,
  type DeleteAttributeQuery,
  type ListAttributesQuery,
  type ResolveMergeTagInput,
  type UpdateAttributeInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { AttributesService } from './attributes.service';

/**
 * Attributes: the workspace's merge variables (WD-CON-042..048). Management routes need the
 * Contact Properties permissions; the picker feed, the catalogue and the preview need only
 * the right to read contacts, because that is what every composer uses.
 */
@ApiTags('attributes')
@ActorKinds('user')
@Controller({ path: 'attributes', version: '2' })
export class AttributesController {
  constructor(private readonly attributes: AttributesService) {}

  @Get()
  @RequirePermission('record.contact-properties.read')
  @ApiOperation({
    summary: 'List attributes with search, status filter and workspace-wide counts',
  })
  async list(@Query(zodPipe(listAttributesQuerySchema)) query: ListAttributesQuery) {
    return this.attributes.list(query);
  }

  // Literal routes before ':id' (Express matches in declaration order).

  @Get('picker')
  @RequirePermission('record.contacts.read')
  @ApiOperation({
    summary: 'The slash-picker feed: built-in tokens plus the ACTIVE custom attributes',
  })
  async picker() {
    return this.attributes.pickerFeed();
  }

  @Get('catalog')
  @RequirePermission('record.contacts.read')
  @ApiOperation({
    summary: 'Every merge token grouped (contact / custom field / workspace / system) with samples',
  })
  async catalog() {
    return this.attributes.catalog();
  }

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.read')
  @ApiOperation({
    summary:
      'Preview a template with the merge tags filled in (for a contact, or with defaults only)',
    description: 'Unresolved tags render as an empty string, as they do when sending.',
  })
  async resolve(@Body(zodPipe(resolveMergeTagSchema)) body: ResolveMergeTagInput) {
    return this.attributes.resolvePreview(body);
  }

  @Get(':id')
  @RequirePermission('record.contact-properties.read')
  @ApiOperation({ summary: 'Get one attribute by uuid' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.attributes.get(id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.contact-properties.create')
  @ApiOperation({
    summary: 'Create an attribute',
    description:
      'Key: lowercase letters, digits and underscores, starting with a letter. Built-in token names are refused (422 CON_ATTRIBUTE_KEY_RESERVED); a taken key is 409 FIELD_KEY_TAKEN.',
  })
  async create(@Body(zodPipe(createAttributeSchema)) body: CreateAttributeInput) {
    return this.attributes.create(body);
  }

  @Patch(':id')
  @RequirePermission('record.contact-properties.update')
  @ApiOperation({
    summary: 'Edit an attribute (name, default, description, active). The key never changes.',
    description: 'Requires the rowVersion you read. `isActive: false` switches it off.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateAttributeSchema)) body: UpdateAttributeInput,
  ) {
    return this.attributes.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.contact-properties.delete')
  @ApiOperation({
    summary: 'Delete an attribute',
    description:
      'Contacts keep their stored values. When some hold one, the call is 409 CON_ATTRIBUTE_IN_USE until repeated with force=true.',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(deleteAttributeQuerySchema)) query: DeleteAttributeQuery,
  ): Promise<void> {
    await this.attributes.remove(id, query);
  }
}
