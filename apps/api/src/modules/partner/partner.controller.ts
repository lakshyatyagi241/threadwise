import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { submitPartnerLeadSchema, type SubmitPartnerLeadInput } from '@crm/contracts';
import { z } from 'zod';
import { ActorKinds, Idempotent } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { PartnerService } from './partner.service';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

/**
 * Sub-agent portal API.
 *
 * Locked to the `partner_agent` token type at the controller level: a staff
 * token cannot reach these routes even with every permission in the system,
 * and an agent token cannot reach the staff routes. Two audiences, two
 * surfaces, no shared middle ground to get wrong.
 */
@ApiTags('partner-portal')
@ActorKinds('partner_agent')
@Controller({ path: 'partner', version: '2' })
export class PartnerController {
  constructor(private readonly partner: PartnerService) {}

  @Post('leads')
  @Idempotent()
  @ApiOperation({
    summary: 'Submit a lead',
    description:
      'Runs the same identity resolution and dedup as a staff-created contact. Submitting a person who already exists attaches to the existing contact instead of duplicating them.',
  })
  async submit(@Body(zodPipe(submitPartnerLeadSchema)) body: SubmitPartnerLeadInput) {
    return this.partner.submitLead(body);
  }

  @Get('leads')
  @ApiOperation({
    summary: "List this agent's submitted leads",
    description: 'Stage is read live from the CRM replica — nothing is cached on the partner side.',
  })
  async list(@Query(zodPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>) {
    return this.partner.listLeads(query.limit, query.cursor);
  }

  @Get('leads/:id')
  @ApiOperation({ summary: 'Live view of one lead (name, contact details, current stage)' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.partner.getLead(id);
  }
}
