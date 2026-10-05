-- chk: an invoice payment attempt can now be made on the shared workspace gateway (Stripe, Razorpay, ...), not only on the generic
-- signed-webhook connection. The attempt's `provider` was limited to 'manual' and 'hmac_generic'; it now takes any gateway slug (the
-- same shape `wa_merchant_gateways.slug` has). Such an attempt has no invoice gateway connection (`connection_id` stays NULL, the
-- column was already nullable): the shared gateway's own webhook settles it by the attempt's uuid, which rides in the reference
-- `INV-<uuid>` that the provider echoes back.

ALTER TABLE invoice_payment_attempts DROP CONSTRAINT chk_invoice_payment_attempts_provider;
ALTER TABLE invoice_payment_attempts
  ADD CONSTRAINT chk_invoice_payment_attempts_provider CHECK (provider ~ '^[a-z0-9_-]{1,64}$');
