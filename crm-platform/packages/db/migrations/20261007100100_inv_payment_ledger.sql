-- inv: the payment ledger and the online-payment attempt tables (TW-PAY-002/003/009/015, "Port decisions").
-- Why this migration exists: Reference's `payments` had no refunds, no reversal, no delete, no currency or tenant check, a payment
-- could link an invoice of another workspace, and the invoice flipped to paid in application code under no lock. Here the table is
-- an APPEND-ONLY LEDGER and the database itself keeps it honest:
--   * a payment is positive, a refund is negative and points at the payment it returns (CHECK);
--   * a payment can only be recorded against an ISSUED invoice of the same currency, and a refund can never return more than the
--     payment it names (trigger, with the invoice and the payment row locked so two concurrent writers serialise);
--   * rows cannot be edited or deleted (only the note and the reference can be amended); a mistake is corrected by a refund;
--   * the invoice's paid_minor / payment_status / paid_at cache is recomputed from the ledger by a trigger in the same
--     transaction, so no code path can leave them disagreeing (D-11, TW-PAY-003 #6).
-- Over-payment is deliberately NOT a database rule: it is a policy the API decides (reject unless the caller says so).

-- --- the ledger -------------------------------------------------------------------------------------------------------------

UPDATE payments SET paid_at = created_at WHERE paid_at IS NULL;

ALTER TABLE payments
  ALTER COLUMN paid_at SET DEFAULT now(),
  ALTER COLUMN paid_at SET NOT NULL,
  ADD COLUMN kind            text NOT NULL DEFAULT 'payment',
  ADD COLUMN refund_of_id    bigint,
  ADD COLUMN receipt_number  text,
  ADD COLUMN attempt_id      bigint,
  ADD CONSTRAINT fk_payments_refund_of FOREIGN KEY (org_id, refund_of_id) REFERENCES payments (org_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT uq_payments_receipt UNIQUE (org_id, receipt_number),
  ADD CONSTRAINT chk_payments_kind CHECK (kind IN ('payment', 'refund')),
  ADD CONSTRAINT chk_payments_amount CHECK (
    (kind = 'payment' AND amount_minor > 0 AND refund_of_id IS NULL)
    OR (kind = 'refund' AND amount_minor < 0 AND refund_of_id IS NOT NULL)
  ),
  ADD CONSTRAINT chk_payments_currency CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT chk_payments_method CHECK (
    method IN ('manual', 'cash', 'bank', 'card', 'upi', 'cheque', 'other', 'gateway', 'wa_pay', 'storefront')
  ),
  ADD CONSTRAINT chk_payments_source CHECK (source IN ('manual', 'gateway', 'wa_pay', 'storefront', 'api')),
  ADD CONSTRAINT chk_payments_text CHECK (
    (reference IS NULL OR char_length(reference) <= 191) AND (note IS NULL OR char_length(note) <= 2000)
  );
CREATE INDEX idx_payments_refund_of ON payments (org_id, refund_of_id) WHERE refund_of_id IS NOT NULL;
CREATE INDEX idx_payments_list ON payments (org_id, paid_at DESC, id DESC);
CREATE INDEX idx_payments_created ON payments (org_id, created_at DESC, id DESC);

CREATE FUNCTION payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  inv   invoices%ROWTYPE;
  par   payments%ROWTYPE;
  taken bigint;
BEGIN
  IF NEW.invoice_id IS NOT NULL THEN
    -- the invoice row lock is what serialises two writers of one invoice's ledger
    SELECT * INTO inv FROM invoices WHERE org_id = NEW.org_id AND id = NEW.invoice_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payment refers to an unknown invoice' USING ERRCODE = '23503';
    END IF;
    IF inv.currency <> NEW.currency THEN
      RAISE EXCEPTION 'payment currency % does not match the invoice currency %', NEW.currency, inv.currency
        USING ERRCODE = '23514';
    END IF;
    IF NEW.kind = 'payment' AND inv.status <> 'issued' THEN
      RAISE EXCEPTION 'payments can only be recorded against an issued invoice (this one is %)', inv.status
        USING ERRCODE = '23514';
    END IF;
    -- a payment brings its invoice's CRM links along, so the ledger can be read per contact or deal (Reference left them blank)
    NEW.contact_id := coalesce(NEW.contact_id, inv.contact_id);
    NEW.company_id := coalesce(NEW.company_id, inv.company_id);
    NEW.deal_id    := coalesce(NEW.deal_id, inv.deal_id);
  END IF;

  IF NEW.kind = 'refund' THEN
    SELECT * INTO par FROM payments WHERE org_id = NEW.org_id AND id = NEW.refund_of_id FOR UPDATE;
    IF NOT FOUND OR par.kind <> 'payment' THEN
      RAISE EXCEPTION 'a refund must name the payment it returns' USING ERRCODE = '23514';
    END IF;
    IF par.invoice_id IS DISTINCT FROM NEW.invoice_id OR par.currency <> NEW.currency THEN
      RAISE EXCEPTION 'a refund must be on the same invoice and currency as its payment' USING ERRCODE = '23514';
    END IF;
    SELECT coalesce(sum(-amount_minor), 0) INTO taken FROM payments WHERE org_id = NEW.org_id AND refund_of_id = par.id;
    IF taken + (-NEW.amount_minor) > par.amount_minor THEN
      RAISE EXCEPTION 'refunds would exceed the payment (% already refunded of %)', taken, par.amount_minor
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payments_guard BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_guard();

-- The cache on the invoice is a pure function of the ledger.
CREATE FUNCTION payments_sync_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.invoice_id IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE invoices i
     SET paid_minor = s.paid,
         refunded_minor = s.refunded,
         payment_status = CASE WHEN i.status <> 'issued' THEN i.payment_status
                               WHEN s.paid >= i.total_minor THEN 'paid'
                               WHEN s.paid > 0 THEN 'partially_paid'
                               ELSE 'unpaid' END,
         paid_at = CASE WHEN i.status = 'issued' AND s.paid >= i.total_minor THEN coalesce(i.paid_at, NEW.paid_at) ELSE NULL END
    FROM (SELECT coalesce(sum(amount_minor), 0) AS paid,
                 coalesce(sum(-amount_minor) FILTER (WHERE kind = 'refund'), 0) AS refunded
            FROM payments WHERE org_id = NEW.org_id AND invoice_id = NEW.invoice_id) s
   WHERE i.org_id = NEW.org_id AND i.id = NEW.invoice_id;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_payments_sync AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_sync_invoice();

-- Append-only. A cascade (a deleted contact clearing contact_id, an organization being removed) runs at trigger depth 2 and
-- passes; a statement issued directly runs at depth 1 and may only amend the note, the reference and the metadata.
CREATE FUNCTION payments_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'the payment ledger is append-only: record a refund instead' USING ERRCODE = '55000';
  END IF;
  IF (NEW.amount_minor, NEW.currency, NEW.invoice_id, NEW.kind, NEW.refund_of_id, NEW.paid_at, NEW.method, NEW.source,
      NEW.gateway_payment_id, NEW.receipt_number, NEW.recorded_by)
     IS DISTINCT FROM
     (OLD.amount_minor, OLD.currency, OLD.invoice_id, OLD.kind, OLD.refund_of_id, OLD.paid_at, OLD.method, OLD.source,
      OLD.gateway_payment_id, OLD.receipt_number, OLD.recorded_by)
  THEN
    RAISE EXCEPTION 'the payment ledger is append-only: record a refund instead' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payments_immutable BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_immutable();

-- --- online payment: the connection, its attempts and the webhook event ledger ---------------------------------------------

-- One connection per organization and provider. `webhook_secret_cipher` is AES-GCM (CryptoService); the endpoint id in the
-- webhook URL is the row's uuid, resolved by invoice_gateway_by_endpoint() before the signature is checked.
CREATE TABLE invoice_gateway_connections (
  org_id               bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id                   bigint GENERATED BY DEFAULT AS IDENTITY,
  uuid                 uuid NOT NULL DEFAULT gen_random_uuid(),
  provider             text NOT NULL,
  enabled              boolean NOT NULL DEFAULT false,
  mode                 text NOT NULL DEFAULT 'test',
  webhook_secret_cipher text,
  created_by           bigint,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  row_version          integer NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, uuid),
  CONSTRAINT uq_invoice_gateway_connections_provider UNIQUE (org_id, provider),
  CONSTRAINT uq_invoice_gateway_connections_endpoint UNIQUE (uuid),
  CONSTRAINT fk_invoice_gateway_connections_user FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id) ON DELETE SET NULL (created_by),
  CONSTRAINT chk_invoice_gateway_connections_provider CHECK (provider IN ('hmac_generic')),
  CONSTRAINT chk_invoice_gateway_connections_mode CHECK (mode IN ('test', 'live')),
  -- a connection with no secret can never be enabled: the webhook fails closed
  CONSTRAINT chk_invoice_gateway_connections_secret CHECK (NOT enabled OR webhook_secret_cipher IS NOT NULL)
);

CREATE TABLE invoice_payment_attempts (
  org_id         bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id             bigint GENERATED BY DEFAULT AS IDENTITY,
  uuid           uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id     bigint NOT NULL,
  connection_id  bigint,
  provider       text NOT NULL,
  amount_minor   bigint NOT NULL,
  currency       text NOT NULL,
  status         text NOT NULL DEFAULT 'pending',
  external_id    text,
  checkout_url   text,
  payment_id     bigint,
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  row_version    integer NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, uuid),
  CONSTRAINT fk_invoice_payment_attempts_invoice FOREIGN KEY (org_id, invoice_id) REFERENCES invoices (org_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_invoice_payment_attempts_connection FOREIGN KEY (org_id, connection_id) REFERENCES invoice_gateway_connections (org_id, id) ON DELETE SET NULL (connection_id),
  CONSTRAINT fk_invoice_payment_attempts_payment FOREIGN KEY (org_id, payment_id) REFERENCES payments (org_id, id) ON DELETE SET NULL (payment_id),
  CONSTRAINT chk_invoice_payment_attempts_amount CHECK (amount_minor > 0 AND currency ~ '^[A-Z]{3}$'),
  CONSTRAINT chk_invoice_payment_attempts_status CHECK (status IN ('pending', 'succeeded', 'failed', 'expired')),
  CONSTRAINT chk_invoice_payment_attempts_provider CHECK (provider IN ('manual', 'hmac_generic'))
);
CREATE INDEX idx_invoice_payment_attempts_invoice ON invoice_payment_attempts (org_id, invoice_id);

-- Every verified webhook event id is recorded once; a redelivery is recognised by the unique key and does nothing.
CREATE TABLE invoice_gateway_events (
  org_id        bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id            bigint GENERATED BY DEFAULT AS IDENTITY,
  connection_id bigint NOT NULL,
  event_id      text NOT NULL,
  event_type    text NOT NULL,
  outcome       text NOT NULL,
  attempt_id    bigint,
  detail        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  CONSTRAINT fk_invoice_gateway_events_connection FOREIGN KEY (org_id, connection_id) REFERENCES invoice_gateway_connections (org_id, id) ON DELETE CASCADE,
  CONSTRAINT uq_invoice_gateway_events UNIQUE (org_id, connection_id, event_id),
  CONSTRAINT chk_invoice_gateway_events_outcome CHECK (outcome IN ('applied', 'ignored', 'rejected'))
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoice_gateway_connections', 'invoice_payment_attempts', 'invoice_gateway_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (org_id = current_org_id() OR app_is_privileged()) WITH CHECK (org_id = current_org_id() OR app_is_privileged())',
      t);
  END LOOP;
END $$;
CREATE TRIGGER trg_invoice_gateway_connections_touch BEFORE UPDATE ON invoice_gateway_connections
  FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER trg_invoice_payment_attempts_touch BEFORE UPDATE ON invoice_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION touch_row();

ALTER TABLE payments
  ADD CONSTRAINT fk_payments_attempt FOREIGN KEY (org_id, attempt_id) REFERENCES invoice_payment_attempts (org_id, id) ON DELETE SET NULL (attempt_id);

-- The webhook arrives with an endpoint id and no tenant: resolve it to the org and the (encrypted) secret so the signature can be
-- verified BEFORE anything else is looked up. Ids and the cipher only; nothing about invoices.
CREATE FUNCTION invoice_gateway_by_endpoint(p_endpoint uuid)
  RETURNS TABLE (org_id bigint, connection_id bigint, provider text, secret_cipher text, enabled boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  SET app.privileged = 'on'
AS $$
  SELECT c.org_id, c.id, c.provider, c.webhook_secret_cipher, c.enabled FROM invoice_gateway_connections c WHERE c.uuid = p_endpoint LIMIT 1
$$;
REVOKE ALL ON FUNCTION invoice_gateway_by_endpoint(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invoice_gateway_by_endpoint(uuid) TO crm_app, crm_worker;
COMMENT ON FUNCTION invoice_gateway_by_endpoint(uuid) IS
  'Resolves an invoice-payment webhook endpoint id to its org, provider and encrypted secret so the signature can be checked before any invoice is read. SECURITY DEFINER because the caller has no tenant context.';
