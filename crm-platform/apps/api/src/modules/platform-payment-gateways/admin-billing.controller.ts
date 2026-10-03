import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  INVOICE_LOGO_MAX_KB,
  adminOrdersQuerySchema,
  billingAnalyticsQuerySchema,
  billingHistoryQuerySchema,
  invoiceMarkPaidRequestSchema,
  invoicesQuerySchema,
  manualInvoiceRequestSchema,
  orderActionRequestSchema,
  orderAnalyticsQuerySchema,
  saveBillingSettingsRequestSchema,
  uuidSchema,
  type AdminOrdersQuery,
  type BillingAnalyticsQuery,
  type BillingHistoryQuery,
  type InvoiceMarkPaidRequest,
  type InvoicesQuery,
  type ManualInvoiceRequest,
  type OrderActionRequest,
  type OrderAnalyticsQuery,
  type SaveBillingSettingsRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { AdminBillingService } from './admin-billing.service';
import { BillingSettingsService } from './billing-settings.service';

const id = () => zodPipe(uuidSchema);

/**
 * The operator console's Billing screens: order history (TW-PAYGW-037..040), billing history (041, 042), invoices (043..046)
 * and billing settings (007). Reference gated them all by "is an admin" with no finer key; here every operator role reads and only
 * a super admin changes anything (approve, reject, cancel, void, delete, create, save), with IP allowlist and MFA from OperatorGuard.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/billing', version: '2' })
export class AdminBillingController {
  constructor(
    private readonly billing: AdminBillingService,
    private readonly settings: BillingSettingsService,
  ) {}

  // ---- order history ---------------------------------------------------------------------------------------------------

  @Get('orders')
  @ApiOperation({
    summary: 'Every order across workspaces with KPIs, filters and the approval queue',
  })
  orders(@Query(zodPipe(adminOrdersQuerySchema)) q: AdminOrdersQuery) {
    return this.billing.listOrders(q);
  }

  @Get('orders/analytics')
  @ApiOperation({
    summary: 'Order analytics: KPIs, motion, type mix, add-ons, funnel, markets, cohorts',
  })
  orderAnalytics(@Query(zodPipe(orderAnalyticsQuerySchema)) q: OrderAnalyticsQuery) {
    return this.billing.orderAnalytics(q);
  }

  @Get('orders/export')
  @ApiOperation({ summary: 'The filtered order list as CSV (capped at 5000 rows)' })
  exportOrders(@Query(zodPipe(adminOrdersQuerySchema)) q: AdminOrdersQuery) {
    return this.billing.exportOrders(q);
  }

  @Get('orders/:id/proof')
  @ApiOperation({
    summary: 'The payment proof the buyer attached to an offline order (bytes, sandboxed)',
  })
  async proof(@Param('id', id()) uuid: string, @Res({ passthrough: true }) res: Response) {
    const proof = await this.billing.proof(uuid);
    const ext = proof.mime === 'application/pdf' ? 'pdf' : proof.mime.split('/')[1];
    res.set({
      'Content-Type': proof.mime,
      'Content-Disposition': `inline; filename="payment-proof.${ext}"`,
      'Cache-Control': 'private, no-store',
      // A receipt is untrusted input from a buyer: it must never run script in the console's origin.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(proof.bytes);
  }

  @Post('orders/:id/approve')
  @OperatorRoles('super_admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark an order paid and apply it (plan, add-on or wallet), once' })
  approve(@Param('id', id()) uuid: string) {
    return this.billing.approve(uuid);
  }

  @Post('orders/:id/reject')
  @OperatorRoles('super_admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject an order or its payment proof, with a note' })
  reject(
    @Param('id', id()) uuid: string,
    @Body(zodPipe(orderActionRequestSchema)) body: OrderActionRequest,
  ) {
    return this.billing.reject(uuid, body);
  }

  @Post('orders/:id/cancel')
  @OperatorRoles('super_admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel an unfinished (pending) order' })
  cancel(@Param('id', id()) uuid: string) {
    return this.billing.cancel(uuid);
  }

  // ---- billing history -------------------------------------------------------------------------------------------------

  @Get('history')
  @ApiOperation({ summary: 'Payment events across workspaces with KPIs and the trend' })
  history(@Query(zodPipe(billingHistoryQuerySchema)) q: BillingHistoryQuery) {
    return this.billing.billingHistory(q);
  }

  @Get('history/analytics')
  @ApiOperation({ summary: 'Billing analytics: cash flow, gateway share, top payers, status mix' })
  historyAnalytics(@Query(zodPipe(billingAnalyticsQuerySchema)) q: BillingAnalyticsQuery) {
    return this.billing.billingAnalytics(q);
  }

  @Get('history/export')
  @ApiOperation({ summary: 'The filtered payment events as CSV (capped at 5000 rows)' })
  exportHistory(@Query(zodPipe(billingHistoryQuerySchema)) q: BillingHistoryQuery) {
    return this.billing.exportBilling(q);
  }

  // ---- invoices --------------------------------------------------------------------------------------------------------

  @Get('invoices')
  @ApiOperation({ summary: 'Platform invoices (orders as billing documents) with KPIs' })
  invoices(@Query(zodPipe(invoicesQuerySchema)) q: InvoicesQuery) {
    return this.billing.listInvoices(q);
  }

  @Get('invoices/export')
  @ApiOperation({ summary: 'The filtered invoices as CSV (capped at 5000 rows)' })
  exportInvoices(@Query(zodPipe(invoicesQuerySchema)) q: InvoicesQuery) {
    return this.billing.exportInvoices(q);
  }

  @Post('invoices')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Issue a manual invoice to a workspace' })
  createInvoice(@Body(zodPipe(manualInvoiceRequestSchema)) body: ManualInvoiceRequest) {
    return this.billing.createManual(body);
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'One invoice, ready to print' })
  invoice(@Param('id', id()) uuid: string) {
    return this.billing.invoiceView(uuid);
  }

  @Post('invoices/:id/mark-paid')
  @OperatorRoles('super_admin')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark an invoice paid (optionally also applying the plan, add-on or wallet)',
  })
  markPaid(
    @Param('id', id()) uuid: string,
    @Body(zodPipe(invoiceMarkPaidRequestSchema)) body: InvoiceMarkPaidRequest,
  ) {
    return this.billing.markPaid(uuid, body);
  }

  @Post('invoices/:id/void')
  @OperatorRoles('super_admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Void an unpaid invoice (it stays on record)' })
  voidInvoice(@Param('id', id()) uuid: string) {
    return this.billing.voidInvoice(uuid);
  }

  @Delete('invoices/:id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Delete an unpaid invoice (audited)' })
  deleteInvoice(@Param('id', id()) uuid: string) {
    return this.billing.deleteInvoice(uuid);
  }

  // ---- billing settings ------------------------------------------------------------------------------------------------

  @Get('settings')
  @ApiOperation({
    summary: 'Tax, refund, yearly, auto-renew, countries and the company identity on invoices',
  })
  readSettings() {
    return this.settings.read();
  }

  @Put('settings')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Save the billing settings (checked against the version the form was loaded with)',
  })
  saveSettings(@Body(zodPipe(saveBillingSettingsRequestSchema)) body: SaveBillingSettingsRequest) {
    return this.settings.save(body);
  }

  @Post('settings/logo')
  @OperatorRoles('super_admin')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: (INVOICE_LOGO_MAX_KB + 1) * 1024, files: 1 } }),
  )
  @ApiOperation({
    summary:
      'Upload the invoice logo (png, jpg, svg or webp up to 1 MB, type checked from the bytes)',
  })
  uploadLogo(@UploadedFile() file: { buffer: Buffer } | undefined) {
    return this.settings.uploadLogo(file?.buffer);
  }

  @Delete('settings/logo')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Remove the invoice logo (invoices fall back to the site logo)' })
  removeLogo() {
    return this.settings.removeLogo();
  }

  @Get('settings/logo')
  @ApiOperation({ summary: 'The invoice logo bytes, for the console preview' })
  async logo(@Res({ passthrough: true }) res: Response) {
    const logo = await this.settings.logo();
    if (!logo) throw AppError.notFound('Invoice logo', 'logo');
    res.set({
      'Content-Type': logo.mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      // An SVG opened on its own must not run script; as an <img> it never does.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(logo.bytes);
  }
}
