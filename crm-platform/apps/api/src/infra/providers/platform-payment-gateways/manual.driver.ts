import {
  failed,
  pending,
  type DriverContext,
  type DriverOrder,
  type ManualInstructions,
  type PaymentDriver,
  type PaymentResult,
  type WebhookPayment,
} from './payment-driver';

const BANK_ROWS: Array<[string, string]> = [
  ['beneficiary_name', 'Beneficiary name'],
  ['bank_name', 'Bank name'],
  ['account_number', 'Account number'],
  ['ifsc_or_swift', 'IFSC / SWIFT'],
  ['branch', 'Branch'],
];

/**
 * Bank transfer and offline gateways (WD-PAYGW-013): no network call and nothing to confirm. `initiate` returns the instructions
 * the buyer needs (the order number is the payment reference); the order stays pending until the buyer uploads proof and an
 * operator approves it (WD-PAYGW-038). WaDesk returned rendered HTML; the browser builds the page from these rows instead.
 */
export class ManualDriver implements PaymentDriver {
  constructor(
    readonly slug: 'bank_transfer' | 'offline',
    private readonly ctx: DriverContext,
  ) {}

  instructionsFor(): ManualInstructions {
    const c = this.ctx.credentials;
    if (this.slug === 'offline') {
      return {
        kind: 'offline',
        rows: [],
        notes: (c.instructions ?? '').trim() || 'Contact us to arrange payment.',
      };
    }
    return {
      kind: 'bank_transfer',
      rows: BANK_ROWS.filter(([k]) => (c[k] ?? '').trim() !== '').map(([k, label]) => ({
        label,
        value: (c[k] ?? '').trim(),
      })),
      notes: (c.notes ?? '').trim() || null,
    };
  }

  async initiate(order: DriverOrder): Promise<PaymentResult> {
    return pending({ gatewayOrderId: order.orderNumber, instructions: this.instructionsFor() });
  }

  /** The callback route is never reached for these gateways; if it is, nothing is proven. */
  async confirmReturn(): Promise<PaymentResult> {
    return failed('awaiting_admin_verification');
  }

  async verifyWebhook(): Promise<boolean> {
    return false;
  }

  parseWebhook(): WebhookPayment | null {
    return null;
  }
}
