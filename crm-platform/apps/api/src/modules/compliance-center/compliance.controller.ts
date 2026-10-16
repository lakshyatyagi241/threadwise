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
  addDncSchema,
  dncListQuerySchema,
  importDncSchema,
  subprocessorInputSchema,
  updateComplianceSettingsSchema,
  updateSubprocessorSchema,
  type AddDncInput,
  type DncListQuery,
  type ImportDncInput,
  type SubprocessorInput,
  type UpdateComplianceSettingsInput,
  type UpdateSubprocessorInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ComplianceChecklistService } from './compliance-checklist.service';
import { ComplianceSettingsService } from './compliance-settings.service';
import { DncService } from './dnc.service';
import { SubprocessorsService } from './subprocessors.service';

/**
 * The Compliance center (BL-172 to BL-176, spec docs/specs/privacy-and-data-governance.md section 11): regime profiles, officer
 * contacts, links, sub-processors and the checklist. Tools to help a workspace comply; no answer here says a workspace is compliant.
 */
@ApiTags('compliance')
@ActorKinds('user')
@Controller({ path: 'compliance', version: '2' })
export class ComplianceController {
  constructor(
    private readonly settings: ComplianceSettingsService,
    private readonly checklist: ComplianceChecklistService,
    private readonly subprocessors: SubprocessorsService,
    private readonly dnc: DncService,
  ) {}

  @Get('settings')
  @RequirePermission('settings.compliance.read', 'settings.compliance.manage')
  @ApiOperation({
    summary:
      'Regime profiles, officer contacts, links, children flag, quiet hours and the country suggestion',
    description:
      '`suggestion` is the profiles the billing (else onboarding) country suggests; nothing is switched on until a person saves. `regimesConfirmedAt` is null until then.',
  })
  getSettings() {
    return this.settings.get();
  }

  @Patch('settings')
  @RequirePermission('settings.compliance.manage')
  @ApiOperation({
    summary: 'Save the whole Compliance center settings document',
    description:
      'Needs the rowVersion read (absent on the first save). 409 ROW_VERSION_CONFLICT, 422 COMPLIANCE_SETTINGS_INVALID. A non-empty `regimes` confirms the profile choice.',
  })
  updateSettings(
    @Body(zodPipe(updateComplianceSettingsSchema)) body: UpdateComplianceSettingsInput,
  ) {
    return this.settings.update(body);
  }

  @Get('links')
  @RequirePermission(
    'settings.compliance.read',
    'settings.compliance.manage',
    'settings.consent.manage',
    'record.forms.update',
  )
  @ApiOperation({
    summary:
      'The workspace privacy and terms links and default notice wording, for the form builder and the notice editor',
  })
  links() {
    return this.settings.links();
  }

  @Get('checklist')
  @RequirePermission('settings.compliance.read', 'settings.compliance.manage')
  @ApiOperation({
    summary:
      'Each baseline point and each requirement of a switched-on profile as built, partial or open',
    description:
      'Worked out from the workspace data. It lists tools in place; it never says the workspace is compliant.',
  })
  getChecklist() {
    return this.checklist.build();
  }

  @Get('subprocessors')
  @RequirePermission('settings.compliance.read', 'settings.compliance.manage')
  @ApiOperation({ summary: 'The workspace sub-processor list' })
  listSubprocessors() {
    return this.subprocessors.list();
  }

  @Post('subprocessors')
  @RequirePermission('settings.compliance.manage')
  @ApiOperation({
    summary:
      'Add a sub-processor (409 COMPLIANCE_SUBPROCESSOR_DUPLICATE for a name already listed)',
  })
  addSubprocessor(@Body(zodPipe(subprocessorInputSchema)) body: SubprocessorInput) {
    return this.subprocessors.create(body);
  }

  @Patch('subprocessors/:id')
  @RequirePermission('settings.compliance.manage')
  @ApiOperation({ summary: 'Change a sub-processor (needs the rowVersion read)' })
  changeSubprocessor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateSubprocessorSchema)) body: UpdateSubprocessorInput,
  ) {
    return this.subprocessors.update(id, body);
  }

  @Delete('subprocessors/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('settings.compliance.manage')
  @ApiOperation({ summary: 'Remove a sub-processor from the list' })
  async removeSubprocessor(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.subprocessors.remove(id);
  }

  @Get('dnc')
  @RequirePermission('settings.compliance.read', 'settings.compliance.manage')
  @ApiOperation({
    summary: 'The Do-Not-Call list: numbers that get no marketing by voice or SMS (newest first)',
    description:
      '`q` matches a part of the number. The ConsentGate reads this list (reason `on_dnc_list`); WhatsApp, email and service messages are not held by it.',
  })
  listDnc(@Query(zodPipe(dncListQuerySchema)) query: DncListQuery) {
    return this.dnc.list(query);
  }

  @Post('dnc')
  @RequirePermission('settings.compliance.manage')
  @ApiOperation({
    summary: 'Add numbers to the Do-Not-Call list',
    description:
      'Up to 1000 numbers. Local numbers are read with `defaultCountryCode`. A number already listed is left as it is; an entry that is not a number is counted and sampled in the answer.',
  })
  addDnc(@Body(zodPipe(addDncSchema)) body: AddDncInput) {
    return this.dnc.add(body);
  }

  @Post('dnc/import')
  @RequirePermission('settings.compliance.manage')
  @ApiOperation({
    summary: 'Add the numbers of a CSV (text) to the Do-Not-Call list',
    description:
      'The column named phone, mobile or number, else the first column. At most 90 KiB of text per request; the screen sends a bigger file in parts. 422 COMPLIANCE_DNC_INVALID for a file with no numbers column.',
  })
  importDnc(@Body(zodPipe(importDncSchema)) body: ImportDncInput) {
    return this.dnc.importCsv(body);
  }

  @Delete('dnc/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('settings.compliance.manage')
  @ApiOperation({ summary: 'Remove a number from the Do-Not-Call list (404 COMPLIANCE_DNC_NOT_FOUND)' })
  async removeDnc(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.dnc.remove(id);
  }
}
