import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listCustomersQuerySchema,
  saveCustomerInputSchema,
  type ListCustomersQuery,
  type SaveCustomerInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { CustomerProfilesService } from './customer-profiles.service';

/** The shop's Customers page (TW-WABA-055, 056): reads need `waba.customers.read`, every change `waba.customers.manage`. */
@ApiTags('whatsapp-customers')
@ActorKinds('user')
@Controller({ path: 'waba/customers', version: '2' })
export class CustomerProfilesController {
  constructor(private readonly customers: CustomerProfilesService) {}

  @Get()
  @RequirePermission('waba.customers.read')
  @ApiOperation({ summary: 'Saved customers, searchable by name, phone or company' })
  list(@Query(zodPipe(listCustomersQuerySchema)) query: ListCustomersQuery) {
    return this.customers.list(query);
  }

  @Put()
  @RequirePermission('waba.customers.manage')
  @ApiOperation({
    summary: 'Save a customer: creates, or updates the one with the same phone digits',
  })
  save(@Body(zodPipe(saveCustomerInputSchema)) body: SaveCustomerInput) {
    return this.customers.save(body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('waba.customers.manage')
  @ApiOperation({ summary: 'Remove a saved customer (their orders are kept)' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.customers.remove(id);
  }
}
