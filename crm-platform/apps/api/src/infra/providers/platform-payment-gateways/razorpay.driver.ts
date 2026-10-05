import { createHash } from 'node:crypto';
import {
  CANCELLED_BY_USER,
  asRecord,
  basicAuth,
  brief,
  failed,
  hmacHex,
  isOk,
  paid,
  pending,
  safeEqual,
  str,
  type DriverContext,
  type DriverOrder,
  type DriverUrls,
  type PaymentDriver,
  type CancelResult,
  type PaymentResult,
  type ProviderPlanKey,
  type SubscriptionEvent,
  type SubscriptionRef,
  type SubscriptionState,
  type WebhookPayment,
} from './payment-driver';

const API = 'https://api.razorpay.com/v1';

/**
 * Razorpay Standard Checkout (WD-PAYGW-015): the server creates a Razorpay order, the browser opens the Razorpay modal with
 * the returned parameters (a client action, never server HTML) and posts the signed result back to the return URL.
 * One-time payments only; subscriptions are WD-PAYGW-012.
 */
export class RazorpayDriver implements PaymentDriver {
  readonly slug = 'razorpay';

  constructor(private readonly ctx: DriverContext) {}

  private get auth(): Record<string, string> {
    return {
      Authorization: basicAuth(
        this.ctx.credentials.key_id ?? '',
        this.ctx.credentials.key_secret ?? '',
      ),
      'Content-Type': 'application/json',
    };
  }

  async initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    const { key_id: keyId, key_secret: secret } = this.ctx.credentials;
    if (!keyId || !secret) return failed('razorpay_credentials_missing');
    try {
      const res = await this.ctx.http(`${API}/orders`, {
        method: 'POST',
        headers: this.auth,
        body: JSON.stringify({
          amount: Number(order.amountMinor),
          currency: order.currency,
          receipt: order.orderNumber,
          notes: { order_number: order.orderNumber },
        }),
      });
      const body = asRecord(res.json);
      const id = str(body.id);
      if (!isOk(res) || !id) {
        return failed(
          `razorpay_http_${res.status}: ${str(asRecord(body.error).description) ?? 'no order id'}`,
        );
      }
      return pending({
        gatewayOrderId: id,
        payload: { razorpay_order_id: id },
        clientAction: {
          provider: 'razorpay',
          params: {
            keyId,
            orderId: id,
            amountMinor: Number(order.amountMinor),
            currency: order.currency,
            name: order.description,
            description: order.orderNumber,
            prefillName: order.customerName ?? '',
            prefillEmail: order.customerEmail ?? '',
            callbackUrl: urls.returnUrl,
          },
        },
      });
    } catch (e) {
      return failed(`razorpay_exception: ${brief(e)}`);
    }
  }

  /**
   * Signature only, as Razorpay documents: HMAC-SHA256 of `order_id|payment_id` with the key secret. A dismissed modal sends
   * `cancelled=1` and is a decline, not a fault (WaDesk burned the order with `missing_razorpay_params`).
   */
  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    if (params.cancelled) return failed(CANCELLED_BY_USER);
    // A subscription checkout returns a subscription id and signs `payment_id|subscription_id` (the reverse of a one-time order).
    if (params.razorpay_subscription_id) {
      const subId = params.razorpay_subscription_id;
      const pay = params.razorpay_payment_id;
      const sig = params.razorpay_signature;
      if (!pay || !sig) return failed('missing_razorpay_sub_params');
      if (order.gatewayOrderId && order.gatewayOrderId !== subId)
        return failed('razorpay_order_mismatch');
      const want = hmacHex('sha256', this.ctx.credentials.key_secret ?? '', `${pay}|${subId}`);
      if (!safeEqual(sig, want)) return failed('razorpay_sub_signature_mismatch');
      return paid(pay, { gateway_subscription_id: subId, razorpay_payment_id: pay });
    }
    const orderId = params.razorpay_order_id;
    const paymentId = params.razorpay_payment_id;
    const signature = params.razorpay_signature;
    if (!orderId || !paymentId || !signature) return failed('missing_razorpay_params');
    if (order.gatewayOrderId && order.gatewayOrderId !== orderId)
      return failed('razorpay_order_mismatch');
    const expected = hmacHex(
      'sha256',
      this.ctx.credentials.key_secret ?? '',
      `${orderId}|${paymentId}`,
    );
    if (!safeEqual(signature, expected)) return failed('razorpay_signature_mismatch');
    return paid(paymentId, { razorpay_order_id: orderId, razorpay_payment_id: paymentId });
  }

  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<boolean> {
    const secret = this.ctx.credentials.webhook_secret;
    const header = headers['x-razorpay-signature'];
    if (!secret || !header) return false;
    return safeEqual(header, hmacHex('sha256', secret, rawBody));
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const evt = asRecord(body);
    if (evt.event !== 'payment.captured' && evt.event !== 'order.paid') return null;
    const payment = asRecord(asRecord(asRecord(evt.payload).payment).entity);
    // A subscription charge also raises payment.captured, carrying an `invoice_id`. It belongs to the subscription path
    // (`subscription.charged`) and is never a one-off payment: handing it to fulfilment could settle an unrelated order.
    if (str(payment.invoice_id)) return null;
    const notes = asRecord(payment.notes);
    const amount = payment.amount;
    return {
      orderNumber: str(notes.order_number),
      gatewayOrderId: str(payment.order_id),
      gatewayPaymentId: str(payment.id),
      amountMinor: typeof amount === 'number' ? BigInt(amount) : undefined,
      currency: str(payment.currency)?.toUpperCase(),
      payload: { razorpay_payment: payment },
    };
  }

  supportsRecurring(): boolean {
    return true;
  }

  /** A plan plus a subscription; the browser opens Razorpay checkout with the subscription id instead of an order id. */
  async createSubscription(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    const { key_id: keyId, key_secret: secret } = this.ctx.credentials;
    if (!keyId || !secret) return failed('razorpay_credentials_missing');
    const rec = order.recurring ?? { interval: 'month' as const, count: 1 };
    const period = { day: 'daily', week: 'weekly', year: 'yearly', month: 'monthly' }[rec.interval];
    const totalCount = { yearly: 10, weekly: 520, daily: 3650, monthly: 120 }[period];
    const err = (j: unknown, status: number): string =>
      str(asRecord(asRecord(j).error).description) ?? `HTTP ${status}`;
    try {
      const cacheKey = {
        account: createHash('sha256').update(keyId).digest('hex'),
        currency: order.currency,
        amountMinor: order.amountMinor,
        unit: rec.interval,
        count: rec.count,
      };
      const makePlan = async (): Promise<string | { error: string }> => {
        const planRes = await this.ctx.http(`${API}/plans`, {
          method: 'POST',
          headers: this.auth,
          body: JSON.stringify({
            period,
            interval: rec.count,
            item: {
              name: order.planName ?? order.description,
              amount: Number(order.amountMinor),
              currency: order.currency,
            },
          }),
        });
        const id = str(asRecord(planRes.json).id);
        if (!isOk(planRes) || !id)
          return { error: `razorpay_plan: ${err(planRes.json, planRes.status)}` };
        await this.rememberPlan(cacheKey, id);
        return id;
      };
      const makeSub = (planId: string) =>
        this.ctx.http(`${API}/subscriptions`, {
          method: 'POST',
          headers: this.auth,
          body: JSON.stringify({
            plan_id: planId,
            total_count: totalCount,
            customer_notify: 1,
            notes: { order_number: order.orderNumber },
          }),
        });

      const cached = await this.cachedPlan(cacheKey);
      let planId: string;
      let subRes;
      if (cached) {
        planId = cached;
        subRes = await makeSub(planId);
        // A reused plan the provider no longer has (deleted in its dashboard): make a fresh one once and remember it instead.
        if (!isOk(subRes) || !str(asRecord(subRes.json).id)) {
          const fresh = await makePlan();
          if (typeof fresh !== 'string') return failed(fresh.error);
          planId = fresh;
          subRes = await makeSub(planId);
        }
      } else {
        const fresh = await makePlan();
        if (typeof fresh !== 'string') return failed(fresh.error);
        planId = fresh;
        subRes = await makeSub(planId);
      }
      const subId = str(asRecord(subRes.json).id);
      if (!isOk(subRes) || !subId)
        return failed(`razorpay_subscription: ${err(subRes.json, subRes.status)}`);
      return pending({
        gatewayOrderId: subId,
        payload: { gateway_subscription_id: subId, gateway_plan_id: planId },
        clientAction: {
          provider: 'razorpay',
          params: {
            keyId,
            subscriptionId: subId,
            name: order.planName ?? order.description,
            description: order.orderNumber,
            callbackUrl: urls.returnUrl,
          },
        },
      });
    } catch (e) {
      return failed(`razorpay_subscription_exception: ${brief(e)}`);
    }
  }

  private async cachedPlan(key: ProviderPlanKey): Promise<string | null> {
    try {
      return (await this.ctx.planCache?.find(key)) ?? null;
    } catch {
      return null; // a cache problem only costs one extra plan
    }
  }

  private async rememberPlan(key: ProviderPlanKey, id: string): Promise<void> {
    try {
      await this.ctx.planCache?.save(key, id);
    } catch {
      /* the next checkout makes another plan; nothing is lost */
    }
  }

  parseSubscriptionWebhook(body: unknown): SubscriptionEvent | null {
    const evt = asRecord(body);
    const payload = asRecord(evt.payload);
    const sub = asRecord(asRecord(payload.subscription).entity);
    const id = str(sub.id);
    if (!id) return null;
    switch (evt.event) {
      case 'subscription.charged':
        return {
          type: 'renewed',
          subscriptionId: id,
          paymentId: str(asRecord(asRecord(payload.payment).entity).id),
          periodEnd: (sub.current_end as number | undefined) ?? null,
          orderNumber: str(asRecord(sub.notes).order_number) ?? null,
        };
      case 'subscription.cancelled':
      case 'subscription.completed':
        return { type: 'canceled', subscriptionId: id };
      case 'subscription.halted':
      case 'subscription.pending':
        return { type: 'payment_failed', subscriptionId: id };
      default:
        return null;
    }
  }

  /** The reconciler's poll: the only driver WaDesk could ask (WD-PAYGW-030). */
  async fetchSubscription(ref: SubscriptionRef): Promise<SubscriptionState | null> {
    if (
      !this.ctx.credentials.key_id ||
      !this.ctx.credentials.key_secret ||
      !ref.gatewaySubscriptionId
    )
      return null;
    try {
      const res = await this.ctx.http(
        `${API}/subscriptions/${encodeURIComponent(ref.gatewaySubscriptionId)}`,
        { method: 'GET', headers: this.auth },
      );
      if (!isOk(res)) return null;
      const s = asRecord(res.json);
      const map: Record<string, SubscriptionState['status']> = {
        active: 'active',
        authenticated: 'active',
        completed: 'active',
        pending: 'past_due',
        halted: 'past_due',
        cancelled: 'canceled',
        expired: 'expired',
      };
      const status = map[String(s.status)];
      return status ? { status, periodEnd: (s.current_end as number | undefined) ?? null } : null;
    } catch {
      return null;
    }
  }

  /** Razorpay: `cancel_at_cycle_end: 1` keeps the cycle already paid and stops the next charge. */
  async cancelSubscription(ref: SubscriptionRef): Promise<CancelResult> {
    if (!this.ctx.credentials.key_id || !this.ctx.credentials.key_secret)
      return { ok: false, reason: 'razorpay_credentials_missing' };
    try {
      const res = await this.ctx.http(
        `${API}/subscriptions/${encodeURIComponent(ref.gatewaySubscriptionId)}/cancel`,
        { method: 'POST', headers: this.auth, body: JSON.stringify({ cancel_at_cycle_end: 1 }) },
      );
      return isOk(res) ? { ok: true } : { ok: false, reason: `razorpay_http_${res.status}` };
    } catch (e) {
      return { ok: false, reason: `razorpay_exception: ${brief(e)}` };
    }
  }
}
