import { Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { StatementQuery } from '@crm/contracts';
import { WalletQueryService } from './wallet-query.service';
import {
  CSV_HEADER,
  CSV_MAX_ROWS,
  TYPE_LABELS,
  csvCell,
  csvDate,
  csvSafe,
  formatMinor,
} from './wallet-rules';

/** Excel needs this at the start of a UTF-8 CSV to read accents and non-Latin names correctly. */
const BOM = String.fromCharCode(0xfeff);

/** The statement as a CSV stream (TW-WALLET-022): oldest first, in chunks, formula-safe, capped. */
@Injectable()
export class WalletExportService {
  constructor(private readonly query: WalletQueryService) {}

  async stream(query: StatementQuery): Promise<{ stream: Readable; fileName: string }> {
    const currency = await this.query.billingCurrency();
    const header = CSV_HEADER.map((h, i) => (i >= 9 ? `${h} (${currency})` : h));
    const rows = this.query.exportRows(query, CSV_MAX_ROWS);
    async function* lines(): AsyncGenerator<string> {
      yield `${BOM}${header.map(csvCell).join(',')}\r\n`;
      for await (const chunk of rows) {
        yield chunk
          .map((r) =>
            [
              csvDate(r.createdAt),
              TYPE_LABELS[r.type] ?? r.type,
              csvSafe(r.description ?? r.note ?? ''),
              csvSafe([r.context?.channel, r.context?.campaignName].filter(Boolean).join(' · ')),
              csvSafe(r.context?.recipient ?? ''),
              csvSafe(r.context?.template ?? ''),
              r.context?.country ?? '',
              r.context?.category ?? '',
              r.context?.engine ?? '',
              // The exact ledger figure (up to four decimals), so the file adds up to the on-screen totals.
              r.moneyInExact && r.moneyInExact !== '0.00'
                ? r.moneyInExact
                : r.moneyInMinor > 0
                  ? formatMinor(r.moneyInMinor)
                  : '',
              r.moneyOutExact && r.moneyOutExact !== '0.00'
                ? r.moneyOutExact
                : r.moneyOutMinor > 0
                  ? formatMinor(r.moneyOutMinor)
                  : '',
              r.balanceAfterExact ?? formatMinor(r.balanceAfterMinor),
            ]
              .map(csvCell)
              .join(','),
          )
          .join('\r\n')
          .concat('\r\n');
      }
    }
    const day = new Date().toISOString().slice(0, 10);
    return { stream: Readable.from(lines()), fileName: `wallet-statement-${day}.csv` };
  }
}
