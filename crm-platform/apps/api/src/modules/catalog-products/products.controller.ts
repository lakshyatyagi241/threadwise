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
  createProductSchema,
  listProductsQuerySchema,
  listReviewsQuerySchema,
  moderateReviewSchema,
  productPickerQuerySchema,
  sendProductSchema,
  updateProductSchema,
  type CreateProductInput,
  type ListProductsQuery,
  type ListReviewsQuery,
  type ModerateReviewInput,
  type ProductPickerQuery,
  type SendProductInput,
  type UpdateProductInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ProductsService } from './products.service';
import { ReviewsService } from './reviews.service';

/**
 * Products (TW-CAT-019..024). No plan flag: Reference gated only the catalog area, never `/store/products`.
 * Literal paths (`picker`) are declared before `:id`.
 */
@ApiTags('products')
@ActorKinds('user')
@Controller({ path: 'catalog/products', version: '2' })
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermission('cat.products.read')
  @ApiOperation({
    summary: 'List products (cursor paginated, 25 by default)',
    description:
      "Reference's order: sort order, then newest. `q` matches name or SKU (case-insensitive, this workspace only). `includeTotal=true` adds `meta.total` for numbered pages.",
  })
  list(@Query(zodPipe(listProductsQuerySchema)) query: ListProductsQuery) {
    return this.products.list(query);
  }

  @Get('picker')
  @RequirePermission('cat.products.read')
  @ApiOperation({
    summary: 'Active, in-stock products for the inbox, chat and Send tab pickers',
    description:
      "At most 120, in the list's order. `q` matches name or SKU. `shopId` keeps that shop's products and the ones that belong to no shop.",
  })
  picker(@Query(zodPipe(productPickerQuerySchema)) query: ProductPickerQuery) {
    return this.products.picker(query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('cat.products.create')
  @ApiOperation({
    summary: 'Create a product',
    description:
      'The slug comes from the name and is made unique per workspace. A prices is entered in major units ("1299.50") and stored x100. With a Meta catalog connected an active product is pushed after the save; a Meta failure never fails the save (the product shows `failed`).',
  })
  @HttpCode(HttpStatus.CREATED)
  create(@Body(zodPipe(createProductSchema)) body: CreateProductInput) {
    return this.products.create(body);
  }

  @Get(':id')
  @RequirePermission('cat.products.read')
  @ApiOperation({ summary: 'Get one product by uuid' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.get(id);
  }

  @Put(':id')
  @Idempotent()
  @RequirePermission('cat.products.update')
  @ApiOperation({
    summary: 'Replace a product',
    description:
      'Needs the `rowVersion` you read (409 ROW_VERSION_CONFLICT otherwise). The slug does not change. A change to a catalog-relevant field pushes the product to Meta after the save.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateProductSchema)) body: UpdateProductInput,
  ) {
    return this.products.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Idempotent()
  @RequirePermission('cat.products.delete')
  @ApiOperation({
    summary: 'Delete a product',
    description:
      'A hard delete (Reference soft-deleted); its reviews and stock holds go with it. Nothing is removed from Meta.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.products.remove(id);
  }

  @Get(':id/share-links')
  @RequirePermission('cat.products.read')
  @ApiOperation({
    summary: 'The shop page of the product and a wa.me link with a ready order text',
    description: '`publicUrl` is null without a shop, `waLink` null without a sender number.',
  })
  shareLinks(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.shareLinks(id);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('cat.catalog.send')
  @ApiOperation({
    summary: 'Send one product (image and caption) to a WhatsApp number',
    description:
      'Goes through the connected device; needs no Meta catalog. 422 for a number under 7 digits (VALIDATION_FAILED) or no connected device (CAT_NO_SENDER); 502 CAT_SEND_FAILED when the device refuses.',
  })
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(sendProductSchema)) body: SendProductInput,
  ) {
    return this.products.sendToNumber(id, body);
  }
}

/** Moderation of the reviews customers post on the public shop (TW-CAT-027). No plan flag, as in Reference. */
@ApiTags('products')
@ActorKinds('user')
@Controller({ path: 'catalog/reviews', version: '2' })
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @RequirePermission('cat.reviews.read')
  @ApiOperation({
    summary: 'Reviews of one status, newest first (cursor paginated, 30 by default)',
    description:
      '`status` is pending, approved or rejected; anything else reads as pending. `meta.counts` has the three totals for the tabs.',
  })
  list(@Query(zodPipe(listReviewsQuerySchema)) query: ListReviewsQuery) {
    return this.reviews.list(query);
  }

  @Put(':id')
  @Idempotent()
  @RequirePermission('cat.reviews.moderate')
  @ApiOperation({ summary: 'Approve, reject or move a review back to pending' })
  moderate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(moderateReviewSchema)) body: ModerateReviewInput,
  ) {
    return this.reviews.moderate(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Idempotent()
  @RequirePermission('cat.reviews.moderate')
  @ApiOperation({
    summary: 'Delete a review',
    description: 'A review that is already gone succeeds, as in Reference.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.reviews.remove(id);
  }
}
