import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { publicPaySchema, type PublicPayInput } from '@crm/contracts';
import { Public } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  InvoicePublicService,
  PUBLIC_PAY_PER_MINUTE,
  PUBLIC_READ_PER_MINUTE,
  PublicRateLimiter,
} from './invoice-public.service';

/** Headers every public answer carries: the page is private to its holder and must not be indexed or cached by a shared proxy. */
const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/**
 * The buyer's invoice page (TW-INV-016/017, D-15): no login, the unguessable token is the capability. Rate limited per client
 * address. An unknown token is 404, a revoked or expired one 410. Nothing here reads or writes anything but its own invoice.
 */
@ApiTags('public-invoices')
@Public()
@Controller({ path: 'public/invoices', version: '2' })
export class InvoicePublicController {
  constructor(
    private readonly service: InvoicePublicService,
    private readonly limiter: PublicRateLimiter,
  ) {}

  @Get(':token')
  @ApiOperation({
    summary: 'The invoice a buyer sees (JSON for the /i/<token> page); counts the view',
    description: 'Rate limited to 120 requests a minute per address. 404 unknown link, 410 INV_LINK_UNAVAILABLE revoked or expired.',
  })
  async view(@Param('token') token: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.limiter.hit('read', req.ip ?? 'unknown', PUBLIC_READ_PER_MINUTE);
    res.set(PRIVATE);
    return this.service.view(token, req.ip);
  }

  @Get(':token/print')
  @ApiOperation({ summary: 'A printable HTML page of the invoice' })
  async print(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    await this.limiter.hit('read', req.ip ?? 'unknown', PUBLIC_READ_PER_MINUTE);
    const html = await this.service.printHtml(token, req.ip);
    res
      .status(200)
      .set({
        ...PRIVATE,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; img-src https:; style-src 'unsafe-inline'; frame-ancestors 'none'",
      })
      .send(html);
  }

  @Get(':token/pdf')
  @ApiOperation({
    summary: 'The invoice as a PDF',
    description: 'A pure render of the frozen invoice: it never triggers a send and counts no view.',
  })
  async pdf(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    await this.limiter.hit('read', req.ip ?? 'unknown', PUBLIC_READ_PER_MINUTE);
    const file = await this.service.pdf(token, req.ip);
    res
      .status(200)
      .set({ ...PRIVATE, 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${file.filename}"` })
      .send(file.bytes);
  }

  @Post(':token/pay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pay now: bank-transfer instructions, or a payment attempt when an online connection is on',
    description:
      'Display-only: it never marks the invoice paid. Only a verified webhook (or staff recording the transfer) does. 20 requests a minute per address.',
  })
  async pay(
    @Param('token') token: string,
    @Body(zodPipe(publicPaySchema)) body: PublicPayInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.limiter.hit('pay', req.ip ?? 'unknown', PUBLIC_PAY_PER_MINUTE);
    res.set(PRIVATE);
    return this.service.pay(token, body, req.ip);
  }
}
