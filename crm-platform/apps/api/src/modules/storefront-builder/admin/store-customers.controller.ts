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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listStoreCustomersQuerySchema,
  storeCustomerIdSchema,
  saveStoreCustomerSchema,
  updateStoreCustomerSchema,
  type ListStoreCustomersQuery,
  type SaveStoreCustomerInput,
  type UpdateStoreCustomerInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { StoreCustomersService } from './store-customers.service';

/** The customers of the store: saved profiles and every buyer found in the orders (Reference /store/customers lists saved profiles only). */
@ApiTags('store-customers')
@ActorKinds('user')
@Controller({ path: 'store/customers', version: '2' })
export class StoreCustomersController {
  constructor(private readonly customers: StoreCustomersService) {}

  @Get()
  @RequirePermission('store.customers.read')
  @ApiOperation({
    summary:
      'Every buyer (saved customers and order-only buyers) by last activity, with order count and lifetime total; search name, phone, company',
  })
  async list(@Query(zodPipe(listStoreCustomersQuerySchema)) query: ListStoreCustomersQuery) {
    return this.customers.list(query);
  }

  @Get(':id')
  @RequirePermission('store.customers.read')
  @ApiOperation({
    summary:
      'One customer (profile uuid or phone:<digits>) with totals, recent orders and the linked contact',
  })
  async get(@Param('id', zodPipe(storeCustomerIdSchema)) id: string) {
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
  @ApiOperation({
    summary:
      'Edit name, company and address (the phone is the key and stays); an order-only buyer gets their profile created',
  })
  async update(
    @Param('id', zodPipe(storeCustomerIdSchema)) id: string,
    @Body(zodPipe(updateStoreCustomerSchema)) body: UpdateStoreCustomerInput,
  ) {
    return this.customers.update(id, body);
  }

  @Delete(':id')
  @Idempotent()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('store.customers.manage')
  @ApiOperation({ summary: 'Remove a saved customer (their orders are kept)' })
  async remove(@Param('id', zodPipe(storeCustomerIdSchema)) id: string): Promise<void> {
    await this.customers.remove(id);
  }
}
