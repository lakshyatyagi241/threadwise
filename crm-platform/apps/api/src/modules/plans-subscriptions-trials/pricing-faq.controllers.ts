import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createPricingFaqRequestSchema,
  publicFaqQuerySchema,
  updatePricingFaqRequestSchema,
  uuidSchema,
  type CreatePricingFaqRequest,
  type PublicFaqQuery,
  type UpdatePricingFaqRequest,
} from '@crm/contracts';
import { ActorKinds, Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { PricingFaqService } from './pricing-faq.service';
import { AllowWhenTrialExpired } from './trial-gate.guard';

/** The operator's FAQ list: every role reads, only super admins write (WD-PLAN-009). */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/pricing-faqs', version: '2' })
export class PlatformPricingFaqsController {
  constructor(private readonly faqs: PricingFaqService) {}

  @Get()
  @ApiOperation({ summary: 'Every FAQ, lowest sort order first' })
  list() {
    return this.faqs.list();
  }

  @Post()
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Add a FAQ (no sort order = last)' })
  create(@Body(zodPipe(createPricingFaqRequestSchema)) body: CreatePricingFaqRequest) {
    return this.faqs.create(body);
  }

  @Patch(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Edit, reorder, move or switch a FAQ on or off' })
  update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updatePricingFaqRequestSchema)) body: UpdatePricingFaqRequest,
  ) {
    return this.faqs.update(id, body);
  }

  @Delete(':id')
  @OperatorRoles('super_admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a FAQ' })
  async remove(@Param('id', zodPipe(uuidSchema)) id: string) {
    await this.faqs.remove(id);
  }
}

/** What the in-app plan picker shows: every active FAQ, whatever its placement. */
@ApiTags('billing')
@ActorKinds('user')
@AllowWhenTrialExpired()
@Controller({ path: 'billing/faqs', version: '2' })
export class BillingFaqsController {
  constructor(private readonly faqs: PricingFaqService) {}

  @Get()
  @ApiOperation({ summary: 'Active FAQs for the plan picker' })
  list() {
    return this.faqs.readers('all');
  }
}

/** The marketing site: `for=pricing` (pricing and both) or `for=home` (home and both). */
@ApiTags('public-pricing')
@Public()
@Controller({ path: 'public/pricing-faqs', version: '2' })
export class PublicPricingFaqsController {
  constructor(private readonly faqs: PricingFaqService) {}

  @Get()
  @ApiOperation({ summary: 'Active FAQs for a public placement' })
  list(@Query(zodPipe(publicFaqQuerySchema)) q: PublicFaqQuery) {
    return this.faqs.readers(q.for);
  }
}
