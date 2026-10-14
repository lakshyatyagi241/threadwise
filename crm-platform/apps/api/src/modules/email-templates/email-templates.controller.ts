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
  createEmailTemplateSchema,
  listEmailTemplatesQuerySchema,
  previewEmailTemplateSchema,
  updateEmailTemplateSchema,
  type CreateEmailTemplateInput,
  type ListEmailTemplatesQuery,
  type PreviewEmailTemplateInput,
  type UpdateEmailTemplateInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { EmailTemplatesService } from './email-templates.service';

/**
 * Email templates (BL-004 / E-14): `/v2/email/templates`. Reading, previewing and keeping personal templates need `mail.templates.read`;
 * changing a SHARED template needs `mail.templates.manage` (decided in the service where the row is known). The whole surface is part
 * of the email add-on: the `email_channel` plan feature.
 */
@ApiTags('email')
@ActorKinds('user')
@RequirePlanFeature('email_channel')
@Controller({ path: 'email/templates', version: '2' })
export class EmailTemplatesController {
  constructor(private readonly templates: EmailTemplatesService) {}

  @Get()
  @RequirePermission('mail.templates.read')
  @ApiOperation({
    summary: 'The shared templates and your own personal ones, newest first',
    description:
      'Search matches name, subject and category. `scope` is all, shared or mine; `status` defaults to active. `categories` lists the categories in use for the filter.',
  })
  list(@Query(zodPipe(listEmailTemplatesQuerySchema)) query: ListEmailTemplatesQuery) {
    return this.templates.list(query);
  }

  @Post('preview')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('mail.templates.read')
  @ApiOperation({
    summary: 'Render unsaved text with sample data',
    description:
      "The editor's live preview: the body is sanitised exactly as it would be saved, `{{variables}}` are filled with sample values, and the variables that stay as written are listed in `issues`. Stores nothing.",
  })
  preview(@Body(zodPipe(previewEmailTemplateSchema)) body: PreviewEmailTemplateInput) {
    return this.templates.preview(body);
  }

  @Get(':id')
  @RequirePermission('mail.templates.read')
  @ApiOperation({ summary: "One template (404 for a colleague's personal one)" })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(id);
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('mail.templates.read')
  @ApiOperation({
    summary: 'Create a template (shared, or personal with scope "mine")',
    description:
      'A shared template needs `mail.templates.manage` (403 EMAIL_TEMPLATE_NOT_EDITABLE otherwise). The name is unique per owner: 409 EMAIL_TEMPLATE_NAME_TAKEN. The HTML is sanitised; the text part is derived when not given. `purpose: "marketing"` makes replies sent from it marketing mail (ConsentGate and unsubscribe link).',
  })
  create(@Body(zodPipe(createEmailTemplateSchema)) body: CreateEmailTemplateInput) {
    return this.templates.create(body);
  }

  @Patch(':id')
  @Idempotent()
  @RequirePermission('mail.templates.read')
  @ApiOperation({
    summary: 'Change, archive or restore a template',
    description:
      'Requires the `rowVersion` you read: 409 ROW_VERSION_CONFLICT otherwise. A shared template needs `mail.templates.manage`; a personal one is its owner\'s. `status: "archived"` hides it from the composer.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateEmailTemplateSchema)) body: UpdateEmailTemplateInput,
  ) {
    return this.templates.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('mail.templates.read')
  @ApiOperation({ summary: 'Delete a template' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.templates.remove(id);
  }
}
