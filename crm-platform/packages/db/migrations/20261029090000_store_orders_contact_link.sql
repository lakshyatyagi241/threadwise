-- store orders join the single CRM: a link from a store order and from a saved WhatsApp customer to the contact it belongs to, and
-- from an order to the sales order and the invoice made from it.
-- Why this migration exists: Reference keeps store customers (wa_orders / wa_customer_profiles, keyed by a bare phone number) apart from
-- contacts, so a buyer is two people: one in the CRM, one in the shop. The owner decided (2026-10-05) to link them on purpose.
-- The links are nullable and SET NULL on delete: an order is financial history and outlives the contact, the sales order and the
-- invoice it points at. A contact cap that blocks a new contact never blocks an order, so contact_id stays null in that case.
-- No new table, so RLS is untouched (wa_orders and wa_customer_profiles keep their forced tenant_isolation policy).

ALTER TABLE wa_orders
  ADD COLUMN contact_id     bigint,
  ADD COLUMN sales_order_id bigint,
  ADD COLUMN invoice_id     bigint,
  ADD CONSTRAINT fk_wa_orders_contact_id     FOREIGN KEY (org_id, contact_id)     REFERENCES contacts (org_id, id)     ON DELETE SET NULL (contact_id),
  ADD CONSTRAINT fk_wa_orders_sales_order_id FOREIGN KEY (org_id, sales_order_id) REFERENCES sales_orders (org_id, id) ON DELETE SET NULL (sales_order_id),
  ADD CONSTRAINT fk_wa_orders_invoice_id     FOREIGN KEY (org_id, invoice_id)     REFERENCES invoices (org_id, id)     ON DELETE SET NULL (invoice_id);

CREATE INDEX idx_wa_orders_contact_id     ON wa_orders (org_id, contact_id)     WHERE contact_id IS NOT NULL;
CREATE INDEX idx_wa_orders_sales_order_id ON wa_orders (org_id, sales_order_id) WHERE sales_order_id IS NOT NULL;
CREATE INDEX idx_wa_orders_invoice_id     ON wa_orders (org_id, invoice_id)     WHERE invoice_id IS NOT NULL;

ALTER TABLE wa_customer_profiles
  ADD COLUMN contact_id bigint,
  ADD CONSTRAINT fk_wa_customer_profiles_contact_id FOREIGN KEY (org_id, contact_id) REFERENCES contacts (org_id, id) ON DELETE SET NULL (contact_id);

CREATE INDEX idx_wa_customer_profiles_contact_id ON wa_customer_profiles (org_id, contact_id) WHERE contact_id IS NOT NULL;

-- Backfill: an order or a profile whose phone (digits only, the key both sides share) is a contact's phone of the same workspace.
-- The contact's identity rows are the canonical keys (E.164 with a "+"), so the "+" is dropped for the comparison; a contact that
-- predates identities is matched on its stored number. When two contacts could match, the oldest live one wins.
-- Row level security is lifted for the statement only: a migration has no tenant, the join is always on org_id.
SELECT set_config('app.privileged', 'on', true);

CREATE TEMP TABLE _store_contact_keys ON COMMIT DROP AS
SELECT DISTINCT ON (org_id, digits) org_id, digits, contact_id
FROM (
  SELECT ci.org_id, regexp_replace(ci.value, '\D', '', 'g') AS digits, ci.contact_id, c.is_archived, 0 AS rank
  FROM contact_identities ci
  JOIN contacts c ON c.org_id = ci.org_id AND c.id = ci.contact_id
  WHERE ci.kind = 'phone'
  UNION ALL
  SELECT c.org_id, regexp_replace(c.normalized_phone, '\D', '', 'g'), c.id, c.is_archived, 1
  FROM contacts c
  WHERE c.normalized_phone IS NOT NULL
) k
WHERE digits <> ''
ORDER BY org_id, digits, is_archived, rank, contact_id;

-- The touch trigger would stamp every backfilled row as edited just now (and bump its row_version); a link is not an edit.
ALTER TABLE wa_orders DISABLE TRIGGER trg_wa_orders_touch;
ALTER TABLE wa_customer_profiles DISABLE TRIGGER trg_wa_customer_profiles_touch;

UPDATE wa_orders o
SET contact_id = k.contact_id
FROM _store_contact_keys k
WHERE o.contact_id IS NULL
  AND k.org_id = o.org_id
  AND k.digits = regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g');

UPDATE wa_customer_profiles p
SET contact_id = k.contact_id
FROM _store_contact_keys k
WHERE p.contact_id IS NULL
  AND k.org_id = p.org_id
  AND k.digits = regexp_replace(p.phone, '\D', '', 'g');

-- An order that was already invoiced from the invoicing side (invoices.wa_order_id) points back at it.
UPDATE wa_orders o
SET invoice_id = i.id
FROM (
  SELECT DISTINCT ON (org_id, wa_order_id) org_id, wa_order_id, id
  FROM invoices
  WHERE wa_order_id IS NOT NULL AND status <> 'void'
  ORDER BY org_id, wa_order_id, id
) i
WHERE o.invoice_id IS NULL AND i.org_id = o.org_id AND i.wa_order_id = o.id;

ALTER TABLE wa_orders ENABLE TRIGGER trg_wa_orders_touch;
ALTER TABLE wa_customer_profiles ENABLE TRIGGER trg_wa_customer_profiles_touch;

SELECT set_config('app.privileged', 'off', true);
