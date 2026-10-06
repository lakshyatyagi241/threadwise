import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createFormSchema,
  duplicateFormSchema,
  formActionSchema,
  formPropertiesQuerySchema,
  listFormsQuerySchema,
  restoreFormVersionSchema,
  updateFormSchema,
  type CreateFormInput,
  type DuplicateFormInput,
  type FormActionInput,
  type FormPropertiesQuery,
  type ListFormsQuery,
  type RecordScope,
  type RestoreFormVersionInput,
  type UpdateFormInput,
} from '@crm/contracts';
import { ActorKinds, GrantedScope, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { FormCatalogueService } from './form-catalogue.service';
import { FormsService } from './forms.service';

/**
 * Forms (docs/specs/forms-builder-app.md 7.1). Every route needs the plan feature `form_builder` (the Forms add-on: 422 PLAN_FEATURE_LOCKED
 * for a workspace without it, reads included, even to a hand-typed URL) and the capability it names. Literal paths (`templates`,
 * `meta/properties`) are declared before `:id`: Express matches in registration order.
 */
@ApiTags('forms')
@ActorKinds('user')
@RequirePlanFeature('form_builder')
@Controller({ path: 'forms', version: '2' })
export class FormsController {
  constructor(
    private readonly forms: FormsService,
    private readonly catalogue: FormCatalogueService,
  ) {}

  @Get('templates')
  @RequirePermission('record.forms.read')
  @ApiOperation({ summary: 'The template gallery (static, versioned in code)' })
  templates() {
    return this.catalogue.templates();
  }

  @Get('meta/properties')
  @RequirePermission('record.forms.read')
  @ApiOperation({
    summary: "The field picker's catalogue: the properties a field can be bound to",
    description:
      'Built-in columns plus every active, writable custom property of the workspace (with its type, options and whether the workspace requires it). `object` is contact or company.',
  })
  properties(@Query(zodPipe(formPropertiesQuerySchema)) query: FormPropertiesQuery) {
    return this.catalogue.properties(query.object);
  }

  @Get()
  @RequirePermission('record.forms.read')
  @ApiOperation({
    summary: 'List forms',
    description:
      'Newest first with the live version, views, submissions and the ones that need review. Archived forms only when asked for.',
  })
  list(
    @Query(zodPipe(listFormsQuerySchema)) query: ListFormsQuery,
    @GrantedScope('record.forms.read') scope: RecordScope,
  ) {
    return this.forms.list(query, scope);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.forms.create')
  @ApiOperation({
    summary: 'Create a form',
    description:
      "Blank, from a gallery template (`templateKey`) or from a definition. 422 PLAN_LIMIT_REACHED over the plan's form cap, 409 FORMS_NAME_TAKEN.",
  })
  create(@Body(zodPipe(createFormSchema)) body: CreateFormInput) {
    return this.forms.create(body);
  }

  @Get(':id')
  @RequirePermission('record.forms.read')
  @ApiOperation({ summary: 'One form: the draft document, the live settings and the share links' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.forms.read') scope: RecordScope,
  ) {
    return this.forms.get(id, scope);
  }

  @Patch(':id')
  @Idempotent()
  @RequirePermission('record.forms.update')
  @ApiOperation({
    summary: 'Edit the draft and the live settings',
    description:
      'Takes the `rowVersion` read; 409 ROW_VERSION_CONFLICT when somebody else wrote first. Editing never changes what the public sees: Publish does.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateFormSchema)) body: UpdateFormInput,
    @GrantedScope('record.forms.update') scope: RecordScope,
  ) {
    return this.forms.update(id, body, scope);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.forms.delete')
  @ApiOperation({
    summary: 'Delete a draft or archived form for good',
    description:
      'With its versions, submissions and events. The contacts and companies its submissions made stay. 409 FORMS_STATE_INVALID for a live or paused form: archive it first.',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.forms.delete') scope: RecordScope,
  ) {
    await this.forms.delete(id, scope);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.forms.update')
  @ApiOperation({
    summary: 'Publish the draft as a new version',
    description:
      '422 FORMS_PUBLISH_INVALID lists every problem as `path: reason` (no_contact_point, crm_required_unbound, bind_unknown_property, ...). A draft that is already live changes nothing.',
  })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(formActionSchema)) body: FormActionInput,
    @GrantedScope('record.forms.update') scope: RecordScope,
  ) {
    return this.forms.publish(id, body, scope);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.forms.update')
  @ApiOperation({ summary: 'Pause a published form: its public page says it is closed' })
  pause(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(formActionSchema)) body: FormActionInput,
    @GrantedScope('record.forms.update') scope: RecordScope,
  ) {
    return this.forms.pause(id, body, scope);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.forms.update')
  @ApiOperation({ summary: 'Open a paused form again, or bring an archived one back' })
  resume(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(formActionSchema)) body: FormActionInput,
    @GrantedScope('record.forms.update') scope: RecordScope,
  ) {
    return this.forms.resume(id, body, scope);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.forms.update')
  @ApiOperation({
    summary: 'Archive a form: its public URL answers 404 and it frees its place under the plan cap',
  })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(formActionSchema)) body: FormActionInput,
    @GrantedScope('record.forms.update') scope: RecordScope,
  ) {
    return this.forms.archive(id, body, scope);
  }

  @Post(':id/duplicate')
  @Idempotent()
  @RequirePermission('record.forms.create')
  @ApiOperation({
    summary: 'Copy a form (draft and settings) under a new name and a new public key',
  })
  duplicate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(duplicateFormSchema)) body: DuplicateFormInput,
    @GrantedScope('record.forms.read') scope: RecordScope,
  ) {
    return this.forms.duplicate(id, body, scope);
  }

  @Post(':id/rotate-key')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.forms.update')
  @ApiOperation({
    summary: 'Give the form a new public key: the old URL, embeds and loader answer 404 at once',
  })
  rotateKey(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(formActionSchema)) body: FormActionInput,
    @GrantedScope('record.forms.update') scope: RecordScope,
  ) {
    return this.forms.rotateKey(id, body, scope);
  }

  @Get(':id/versions')
  @RequirePermission('record.forms.read')
  @ApiOperation({ summary: 'The published versions of a form, newest first' })
  versions(
    @Param('id', ParseUUIDPipe) id: string,
    @GrantedScope('record.forms.read') scope: RecordScope,
  ) {
    return this.forms.versions(id, scope);
  }

  @Post(':id/versions/:version/restore')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('record.forms.update')
  @ApiOperation({ summary: 'Copy a version into the draft (it is not republished)' })
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
    @Body(zodPipe(restoreFormVersionSchema)) body: RestoreFormVersionInput,
    @GrantedScope('record.forms.update') scope: RecordScope,
  ) {
    return this.forms.restoreVersion(id, version, body, scope);
  }
}
