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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  subprocessorInputSchema,
  updateComplianceSettingsSchema,
  updateSubprocessorSchema,
  type SubprocessorInput,
  type UpdateComplianceSettingsInput,
  type UpdateSubprocessorInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ComplianceChecklistService } from './compliance-checklist.service';
import { ComplianceSettingsService } from './compliance-settings.service';
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
}
