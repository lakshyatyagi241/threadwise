import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  orderCancelInputSchema,
  orderConfirmInputSchema,
  orderParseInputSchema,
  orderReplyInputSchema,
  orderShippingInputSchema,
  type OrderCancelInput,
  type OrderCancelResult,
  type OrderConfirmInput,
  type OrderConfirmResult,
  type OrderParseInput,
  type OrderParseResult,
  type OrderReplyInput,
  type OrderReplyResult,
  type OrderShippingInput,
  type OrderShippingResult,
} from '@crm/contracts';
import { Public } from '../../../../../common/decorators';
import { RequestContextStore } from '../../../../../common/context/request-context';
import { zodPipe } from '../../../../../common/pipes/zod-validation.pipe';
import { ApiKeyGuard } from '../../../../public-api';
import { OrderingFlowService } from './ordering.service';

/**
 * The ordering calls a flow's Webhook node makes (TW-FLR-042; Reference's `/api/flow-node/order-*`): parse a customer's text into a
 * held cart, take the delivery address, confirm, cancel, or decide a reply. Authenticated by the API key (a flow's Webhook node
 * carries one as a header), scoped to the key's workspace. The workspace is the key's, never a `workspace_id` in the body.
 */
@ApiTags('public-api')
@Public()
@UseGuards(ApiKeyGuard)
@ApiHeader({ name: 'Authorization', description: 'ApiKey <prefix>.<secret>', required: true })
@ApiHeader({
  name: 'X-Signature',
  description: 'hex HMAC-SHA256 of `{timestamp}.{METHOD}.{path}.{rawBody}`',
  required: true,
})
@ApiHeader({ name: 'X-Timestamp', description: 'Unix seconds', required: true })
@Controller({ path: 'public/v1/flows/ordering', version: VERSION_NEUTRAL })
export class OrderingFlowController {
  constructor(private readonly svc: OrderingFlowService) {}

  private org(): number {
    return RequestContextStore.require().orgId;
  }

  @Post('parse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Turn a customer's text into a held cart",
    description:
      'Returns the items, what was not available, the total, the summary and the delivery-address prompt, both in the customer language.',
  })
  parse(@Body(zodPipe(orderParseInputSchema)) body: OrderParseInput): Promise<OrderParseResult> {
    return this.svc.parse(this.org(), body);
  }

  @Post('shipping')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Take the delivery address from the customer reply',
    description: '422 when use_saved has no address on file, or the reply is empty.',
  })
  shipping(
    @Body(zodPipe(orderShippingInputSchema)) body: OrderShippingInput,
  ): Promise<OrderShippingResult> {
    return this.svc.shipping(this.org(), body);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Place the held cart as an order',
    description:
      'Answers 200 with ok false and a localized summary when the cart is empty or expired, so the flow never shows a blank bubble.',
  })
  confirm(
    @Body(zodPipe(orderConfirmInputSchema)) body: OrderConfirmInput,
  ): Promise<OrderConfirmResult> {
    return this.svc.confirm(this.org(), body);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Drop the cart and release its held stock' })
  cancel(
    @Body(zodPipe(orderCancelInputSchema)) body: OrderCancelInput,
  ): Promise<OrderCancelResult> {
    return this.svc.cancel(this.org(), body);
  }

  @Post('reply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decide the reply to the order summary: confirm, cancel or ask again',
    description: 'The reply may be in any language. An unclear reply never cancels.',
  })
  reply(@Body(zodPipe(orderReplyInputSchema)) body: OrderReplyInput): Promise<OrderReplyResult> {
    return this.svc.reply(this.org(), body);
  }
}
