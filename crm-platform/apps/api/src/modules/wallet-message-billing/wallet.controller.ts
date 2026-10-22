import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  expenseListQuerySchema,
  expenseSummaryQuerySchema,
  messagePricingQuerySchema,
  statementQuerySchema,
  walletLedgerQuerySchema,
  type ExpenseListQuery,
  type ExpenseSummaryQuery,
  type StatementQuery,
  type WalletLedgerQuery,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { WalletExpensesService } from './wallet-expenses.service';
import { WalletExportService } from './wallet-export.service';
import { WalletQueryService } from './wallet-query.service';

/** The workspace's own wallet: balance, activity, statement and the price panel (TW-WALLET-020 to -024). */
@ApiTags('wallet')
@ActorKinds('user')
@Controller({ path: 'wallet', version: '2' })
export class WalletController {
  constructor(
    private readonly query: WalletQueryService,
    private readonly exporter: WalletExportService,
    private readonly expenses: WalletExpensesService,
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

  @Get('snapshot')
  @RequirePermission('wallet.balance.read')
  @ApiOperation({
    summary:
      'One-call wallet view for the mobile app and the extension: mode, balance, messages left, month spend',
  })
  async snapshot() {
    return this.query.snapshot();
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
      'Money in and out are classified by direction. `type=topup` lists top-ups (they matched nothing in Reference).',
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

  @Get('expenses')
  @RequirePermission('wallet.statement.read')
  @ApiOperation({
    summary:
      'Message expense log: one row per billable message, with its template and what it cost (cursor paginated)',
    description:
      'Filters: status, from, to, template, source and category. A row is one message: charged, free or refunded, with the amount it took and gave back.',
  })
  async expenseLog(@Query(zodPipe(expenseListQuerySchema)) q: ExpenseListQuery) {
    return this.expenses.list(q);
  }

  @Get('expenses/summary')
  @RequirePermission('wallet.statement.read')
  @ApiOperation({
    summary:
      'Message expenses grouped by template, channel, category or country, with totals over the whole filtered set',
  })
  async expenseSummary(@Query(zodPipe(expenseSummaryQuerySchema)) q: ExpenseSummaryQuery) {
    return this.expenses.summary(q);
  }

  @Get('pricing')
  @RequirePermission('wallet.balance.read')
  @ApiOperation({ summary: 'Base price of each message category (for one country when given)' })
  async pricing(@Query(zodPipe(messagePricingQuerySchema)) q: { country?: string }) {
    return this.query.pricing(q.country);
  }
}
