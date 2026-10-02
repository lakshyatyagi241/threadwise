import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  messagePricingQuerySchema,
  statementQuerySchema,
  walletLedgerQuerySchema,
  type StatementQuery,
  type WalletLedgerQuery,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { WalletExportService } from './wallet-export.service';
import { WalletQueryService } from './wallet-query.service';

/** The workspace's own wallet: balance, activity, statement and the price panel (WD-WALLET-020 to -024). */
@ApiTags('wallet')
@ActorKinds('user')
@Controller({ path: 'wallet', version: '2' })
export class WalletController {
  constructor(
    private readonly query: WalletQueryService,
    private readonly exporter: WalletExportService,
  ) {}

  @Get('summary')
  @RequirePermission('wallet.balance.read')
  @ApiOperation({
    summary:
      'Balance, 30-day movement, billing mode and plan allowance (the wallet tab and the balance chip)',
  })
  async summary() {
    return this.query.summary();
  }

  @Get('ledger')
  @RequirePermission('wallet.statement.read')
  @ApiOperation({ summary: 'Recent wallet activity, newest first (cursor paginated)' })
  async ledger(@Query(zodPipe(walletLedgerQuerySchema)) q: WalletLedgerQuery) {
    return this.query.ledger(q);
  }

  @Get('statement')
  @RequirePermission('wallet.statement.read')
  @ApiOperation({
    summary: 'The statement: filters, totals over the whole filtered set, per-message context',
    description:
      'Money in and out are classified by direction. `type=topup` lists top-ups (they matched nothing in WaDesk).',
  })
  async statement(@Query(zodPipe(statementQuerySchema)) q: StatementQuery) {
    return this.query.statement(q);
  }

  @Get('statement.csv')
  @RequirePermission('wallet.statement.export')
  @ApiOperation({
    summary: 'The statement as CSV, oldest first (at most 50,000 rows)',
    description:
      'Same filters as the statement. Text cells that could run as a formula are neutralised.',
  })
  async statementCsv(
    @Query(zodPipe(statementQuerySchema)) q: StatementQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, fileName } = await this.exporter.stream(q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return new StreamableFile(stream);
  }

  @Get('pricing')
  @RequirePermission('wallet.balance.read')
  @ApiOperation({ summary: 'Base price of each message category (for one country when given)' })
  async pricing(@Query(zodPipe(messagePricingQuerySchema)) q: { country?: string }) {
    return this.query.pricing(q.country);
  }
}
