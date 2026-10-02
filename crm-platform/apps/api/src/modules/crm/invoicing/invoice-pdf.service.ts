import { Injectable } from '@nestjs/common';
import type { RecordScope } from '@crm/contracts';
import { InvoicePublicService } from './invoice-public.service';
import { renderInvoicePdf } from './invoice-render';

/** The authenticated PDF download: the same pure render the buyer's link uses, behind the staff permission and scope. */
@Injectable()
export class InvoicePdfService {
  constructor(private readonly docs: InvoicePublicService) {}

  async forStaff(uuid: string, scope: RecordScope): Promise<{ bytes: Buffer; filename: string }> {
    const doc = await this.docs.documentForStaff(uuid, scope);
    return { bytes: renderInvoicePdf(doc), filename: `${doc.number}.pdf` };
  }
}
