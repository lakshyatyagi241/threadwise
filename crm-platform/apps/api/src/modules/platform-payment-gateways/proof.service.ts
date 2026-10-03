import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  PAYGW_PROOF_MAX_BYTES,
  type PaygwProofFields,
  type PaygwProofResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { sniffImage } from './image-sniff';
import { recordOrderEvent } from './order-events';
import { MANUAL_GATEWAYS } from './gateway-rules';
import { OrdersRepository } from './orders.repository';

export const PROOF_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

/** The file's real type from its first bytes: JPG, PNG, WEBP or PDF. The client's claimed type and name are never trusted. */
export function sniffProof(buf: Buffer): (typeof PROOF_MIMES)[number] | null {
  if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  const img = sniffImage(buf);
  return img === 'image/png' || img === 'image/jpeg' || img === 'image/webp' ? img : null;
}

/**
 * Proof of an offline payment (WD-PAYGW-013). The buyer attaches a receipt to a pending bank-transfer or offline order; the order
 * then shows in the operators' awaiting-approval queue (WD-PAYGW-038). The status does not change here: only an operator settles
 * the order. A re-upload while pending replaces the previous file (WaDesk left it orphaned on the disk).
 */
@Injectable()
export class ProofService {
  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersRepository,
    private readonly outbox: OutboxService,
  ) {}

  async submit(
    orderUuid: string,
    file: Buffer | undefined,
    fields: PaygwProofFields,
  ): Promise<PaygwProofResponse> {
    const ctx = RequestContextStore.require();
    if (!ctx.userId) throw AppError.unauthenticated();
    if (!file || file.length === 0) {
      throw AppError.validation('Choose a receipt to upload', [
        { path: 'proof', message: 'a file is required' },
      ]);
    }
    if (file.length > PAYGW_PROOF_MAX_BYTES) {
      throw AppError.validation('The file is too large', [
        { path: 'proof', message: 'must be at most 4 MB' },
      ]);
    }
    const mime = sniffProof(file);
    if (!mime) {
      throw AppError.validation('This file type is not allowed here', [
        { path: 'proof', message: 'must be a JPG, PNG, WEBP or PDF' },
      ]);
    }
    return this.db.tx(async (tx) => {
      // RLS scopes this to the caller's workspace: another workspace's order is simply not found.
      const order = await this.orders.byUuid(tx, orderUuid);
      if (!order) throw AppError.notFound('Order', orderUuid);
      if (
        order.status !== 'pending' ||
        !order.gatewaySlug ||
        !MANUAL_GATEWAYS.includes(order.gatewaySlug)
      ) {
        throw new AppError(
          ERROR_CODES.PAYGW_ORDER_STATE,
          'Payment proof can no longer be submitted for this order.',
          HttpStatus.CONFLICT,
        );
      }
      await tx.execute(sql`
        INSERT INTO order_proof_blobs (org_id, order_id, mime, byte_size, bytes)
        VALUES (${order.orgId}, ${order.id}, ${mime}, ${file.length}, ${file})
        ON CONFLICT (org_id, order_id) DO UPDATE
          SET mime = EXCLUDED.mime, byte_size = EXCLUDED.byte_size, bytes = EXCLUDED.bytes`);
      const res = await tx.execute(sql`
        UPDATE orders SET payment_proof_path = ${`proof/${order.uuid}`}, payment_reference = ${fields.paymentReference ?? null},
          proof_note = ${fields.proofNote ?? null}, proof_submitted_at = now()
        WHERE org_id = ${order.orgId} AND id = ${order.id} AND status = 'pending'
        RETURNING to_char(proof_submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`);
      const at = (res.rows[0] as { at: string }).at;
      await recordOrderEvent(tx, this.outbox, order, 'proof_submitted', {
        reference: fields.paymentReference ?? null,
        mime,
        bytes: file.length,
      });
      return { orderNumber: order.orderNumber, status: order.status, proofSubmittedAt: at };
    });
  }
}
