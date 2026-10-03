-- cpn: integrity rules and starter data for the coupon, credit-package and currency tables.
-- Why this migration exists: the first CPN migration (20261001100500) only mirrored WaDesk's columns. WaDesk enforced its rules in
-- PHP and left the gaps to MySQL's case-insensitive collation; here the rules live in the database so two operators racing, or a
-- bug in a caller, cannot store a coupon "save20" next to "SAVE20", a percent below zero, a window that ends before it starts,
-- a currency code of the wrong shape or a rate of zero (which would divide every conversion by zero).
-- Additive only: applied migrations are immutable.

-- Coupons: the code is stored upper-cased (the service upper-cases it; this makes a direct write unable to break uniqueness).
ALTER TABLE coupons
  ADD CONSTRAINT chk_coupons_code CHECK (code = upper(code) AND length(code) BETWEEN 1 AND 64),
  ADD CONSTRAINT chk_coupons_type CHECK (type IN ('percent', 'fixed')),
  ADD CONSTRAINT chk_coupons_amount CHECK (amount >= 0),
  ADD CONSTRAINT chk_coupons_caps CHECK (
    (max_discount_amount IS NULL OR max_discount_amount >= 0)
    AND (min_order_amount IS NULL OR min_order_amount >= 0)
    AND (max_uses IS NULL OR max_uses >= 1)
    AND (per_user_limit IS NULL OR per_user_limit >= 1)
    AND uses_count >= 0),
  ADD CONSTRAINT chk_coupons_window CHECK (starts_at IS NULL OR expires_at IS NULL OR expires_at >= starts_at),
  -- plan and add-on slugs; an empty array means "any plan"
  ADD CONSTRAINT chk_coupons_plans CHECK (applicable_package_ids IS NULL OR jsonb_typeof(applicable_package_ids) = 'array');

-- Credit packages.
ALTER TABLE credit_packages
  ADD CONSTRAINT chk_credit_packages_slug CHECK (slug ~ '^[A-Za-z0-9_-]{1,96}$'),
  ADD CONSTRAINT chk_credit_packages_price CHECK (price_minor >= 0),
  ADD CONSTRAINT chk_credit_packages_credits CHECK (credits BETWEEN 1 AND 100000000),
  ADD CONSTRAINT chk_credit_packages_sort CHECK (sort_order BETWEEN 0 AND 9999),
  ADD CONSTRAINT chk_credit_packages_currency CHECK (currency_code ~ '^[A-Z]{3}$');

-- Currencies: ISO shape, a usable number of decimals and a rate that cannot be zero.
ALTER TABLE currencies
  ADD CONSTRAINT chk_currencies_code CHECK (code ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT chk_currencies_precision CHECK (precision BETWEEN 0 AND 6),
  ADD CONSTRAINT chk_currencies_rate CHECK (exchange_rate >= 0.000001);

-- WD-CPN-025: WaDesk's 30 starter currencies, rate = units per 1 USD. DO NOTHING on conflict: re-running never overwrites an
-- operator's edits (WaDesk's seeder reset them).
INSERT INTO currencies (code, name, symbol, "precision", exchange_rate) VALUES
  ('USD', 'US Dollar', '$', 2, 1),
  ('EUR', 'Euro', '€', 2, 0.92),
  ('GBP', 'British Pound', '£', 2, 0.79),
  ('INR', 'Indian Rupee', '₹', 2, 83.25),
  ('AED', 'UAE Dirham', 'د.إ', 2, 3.673),
  ('SAR', 'Saudi Riyal', '﷼', 2, 3.75),
  ('CAD', 'Canadian Dollar', 'CA$', 2, 1.36),
  ('AUD', 'Australian Dollar', 'A$', 2, 1.53),
  ('JPY', 'Japanese Yen', '¥', 0, 149),
  ('CNY', 'Chinese Yuan', '¥', 2, 7.25),
  ('HKD', 'Hong Kong Dollar', 'HK$', 2, 7.82),
  ('SGD', 'Singapore Dollar', 'S$', 2, 1.35),
  ('MYR', 'Malaysian Ringgit', 'RM', 2, 4.70),
  ('IDR', 'Indonesian Rupiah', 'Rp', 0, 15700),
  ('THB', 'Thai Baht', '฿', 2, 36.2),
  ('PHP', 'Philippine Peso', '₱', 2, 56.5),
  ('VND', 'Vietnamese Dong', '₫', 0, 24500),
  ('KRW', 'South Korean Won', '₩', 0, 1350),
  ('TRY', 'Turkish Lira', '₺', 2, 32.5),
  ('EGP', 'Egyptian Pound', 'E£', 2, 47.5),
  ('ZAR', 'South African Rand', 'R', 2, 18.5),
  ('NGN', 'Nigerian Naira', '₦', 2, 1600),
  ('KES', 'Kenyan Shilling', 'KSh', 2, 129),
  ('BRL', 'Brazilian Real', 'R$', 2, 5.10),
  ('MXN', 'Mexican Peso', 'MX$', 2, 17.3),
  ('ARS', 'Argentine Peso', 'AR$', 2, 950),
  ('CLP', 'Chilean Peso', 'CLP$', 0, 920),
  ('COP', 'Colombian Peso', 'CO$', 0, 4000),
  ('PKR', 'Pakistani Rupee', '₨', 2, 278),
  ('BDT', 'Bangladeshi Taka', '৳', 2, 110)
ON CONFLICT (code) DO NOTHING;

-- WaDesk's three starter credit packages (its create-table migration seeded them). Prices are in INR minor units (paise).
INSERT INTO credit_packages (name, slug, price_minor, currency_code, credits, badge, description, is_active, is_featured, sort_order) VALUES
  ('Starter', 'starter', 10000, 'INR', 5000, NULL, '5,000 message credits - perfect for trial sends.', true, false, 10),
  ('Growth', 'growth', 50000, 'INR', 27500, 'Most popular', '27,500 credits - 10% bonus over starter rate.', true, true, 20),
  ('Scale', 'scale', 100000, 'INR', 60000, 'Best value', '60,000 credits - 20% bonus, ideal for active campaigns.', true, false, 30)
ON CONFLICT (slug) DO NOTHING;
