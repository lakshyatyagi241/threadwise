import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listStoreCustomersQuerySchema,
  saveStoreCustomerSchema,
  updateStoreCustomerSchema,
  type ListStoreCustomersQuery,
  type SaveStoreCustomerInput,
  type UpdateStoreCustomerInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { StoreCustomersService } from './store-customers.service';

/** The saved customers of the store (Reference /store/customers). */
@ApiTags('store-customers')
@ActorKinds('user')
@Controller({ path: 'store/customers', version: '2' })
export class StoreCustomersController {
  constructor(private readonly customers: StoreCustomersService) {}

  @Get()
  @RequirePermission('store.customers.read')
  @ApiOperation({
    summary:
      'Saved customers by name then phone, with order count and lifetime total; search name, phone, company',
  })
  async list(@Query(zodPipe(listStoreCustomersQuerySchema)) query: ListStoreCustomersQuery) {
    return this.customers.list(query);
  }

  @Get(':id')
  @RequirePermission('store.customers.read')
  @ApiOperation({ summary: 'One customer with totals, recent orders and the linked contact' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(id);
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('store.customers.manage')
  @ApiOperation({
    summary: 'Save a customer by phone (creates or updates, as Reference)',
    description: '422 when the phone has no digits. Answers 200 with the customer either way.',
  })
  async save(@Body(zodPipe(saveStoreCustomerSchema)) body: SaveStoreCustomerInput) {
    return this.customers.save(body);
  }

  @Put(':id')
  @Idempotent()
  @RequirePermission('store.customers.manage')
  @ApiOperation({ summary: 'Edit name, company and address (the phone is the key and stays)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateStoreCustomerSchema)) body: UpdateStoreCustomerInput,
  ) {
    return this.customers.update(id, body);
  }

  @Delete(':id')
  @Idempotent()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('store.customers.manage')
  @ApiOperation({ summary: 'Remove a saved customer (their orders are kept)' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.customers.remove(id);
  }
}
