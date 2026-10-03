import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, type PaygwBuyerInvoice } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AdminBillingRepository } from './admin-billing.repository';
import { AdminBillingService } from './admin-billing.service';
import { CheckoutSettingsService } from './checkout-settings.service';

/**
 * The buyer's own invoice for one order (TW-PAYGW-036). Read in the caller's workspace (row-level security hides another
 * workspace's order as "not found"); inside the workspace only the buyer who placed the order may open it (Reference: 403
 * "Not your order."). Works for any status, as Reference's did. The document is the operator's invoice built from the same rows.
 */
@Injectable()
export class BuyerInvoiceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AdminBillingRepository,
    private readonly admin: AdminBillingService,
    private readonly settings: CheckoutSettingsService,
  ) {}

  async view(orderUuid: string): Promise<PaygwBuyerInvoice> {
    const ctx = RequestContextStore.require();
    if (!ctx.userId) throw AppError.unauthenticated();
    const raw = await this.db.tx((tx) => this.repo.invoiceDetail(tx, orderUuid));
    if (!raw) throw AppError.notFound('Order', orderUuid);
    if (Number(raw.user_id) !== ctx.userId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Not your order.', HttpStatus.FORBIDDEN);
    }
    const [v, s] = await Promise.all([this.admin.viewFromRaw(raw), this.settings.load()]);
    const { workspace: _w, gatewaySlug: _g, manual: _m, payment, ...rest } = v;
    return {
      ...rest,
      payment: {
        reference: payment.reference,
        paidAt: payment.paidAt,
        couponCode: payment.couponCode,
      },
      refundDays: s.refundEnabled ? s.refundDays : null,
    };
  }
}
