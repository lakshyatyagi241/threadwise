-- TW-PAYGW-002: gateway names and descriptions follow Reference's wording. Rows created by an earlier release
-- kept the first catalogue text; there is no rename screen, so the catalogue text is the truth.
UPDATE payment_gateways g
   SET name = v.name, description = v.description
  FROM (VALUES
  ('stripe', 'Stripe', 'Global cards + Apple Pay + Google Pay across 46+ countries.'),
  ('paypal', 'PayPal', 'Worldwide PayPal balance + cards via PayPal Checkout.'),
  ('razorpay', 'Razorpay', 'India — cards, UPI, netbanking, wallets, EMI.'),
  ('paytm', 'Paytm', 'India — Paytm wallet, UPI, cards, netbanking.'),
  ('mollie', 'Mollie', 'European cards, iDEAL, Bancontact, SEPA, Klarna.'),
  ('paystack', 'Paystack', 'Nigeria/Ghana/South Africa — cards, bank, USSD, mobile money.'),
  ('flutterwave', 'Flutterwave', 'Africa-wide — cards, mobile money, USSD, bank transfer.'),
  ('square', 'Square', 'US/CA/UK/AU/JP cards via Square Online Checkout.'),
  ('braintree', 'Braintree', 'PayPal-owned: cards, PayPal, Venmo, Apple Pay, Google Pay.'),
  ('twocheckout', '2Checkout (Verifone)', '200+ countries — global cards + local payment methods.'),
  ('coinbase', 'Coinbase Commerce', 'Crypto — BTC, ETH, USDC, DAI, LTC, BCH.'),
  ('mercadopago', 'Mercado Pago', 'Latin America — cards, Pix, OXXO, Boleto, wallet.'),
  ('iyzico', 'iyzico', 'Turkey — cards with 3D Secure + installments.'),
  ('paddle', 'Paddle', 'Merchant of record for SaaS — cards + global tax handling.'),
  ('authorize_net', 'Authorize.Net', 'US/CA cards via Accept Hosted payment page.'),
  ('sslcommerz', 'SSLCommerz', 'Bangladesh — cards, bKash, Nagad, Rocket.'),
  ('instamojo', 'Instamojo', 'India — cards, UPI, netbanking, wallets via payment links.'),
  ('phonepe', 'PhonePe', 'India — UPI, cards, wallets via PhonePe Business.'),
  ('cashfree', 'Cashfree', 'India — UPI, cards, netbanking, wallets, BNPL.'),
  ('payu', 'PayU', 'India / LatAm — cards, UPI, netbanking, wallets.'),
  ('midtrans', 'Midtrans', 'Indonesia — cards, GoPay, OVO, ShopeePay, bank transfer.'),
  ('duitku', 'Duitku', 'Indonesia — VA banks, QRIS, OVO, DANA, ShopeePay, retail (Alfamart/Indomaret), cards.'),
  ('xendit', 'Xendit', 'SE Asia — cards, e-wallets, virtual accounts, OTC retail.'),
  ('tap', 'Tap Payments', 'Middle East — KNET, mada, Benefit, cards in AED/SAR/KWD.'),
  ('hyperpay', 'HyperPay', 'Middle East / Africa — cards (mada, Visa/MC/Amex) + STC Pay.'),
  ('paytr', 'PayTR', 'Turkey — cards with installments via secure iframe.'),
  ('fondy', 'Fondy', 'Eastern Europe — cards, Apple Pay, Google Pay, SEPA.'),
  ('skrill', 'Skrill', 'Skrill wallet + 100+ local methods worldwide.'),
  ('cinetpay', 'CinetPay', 'Francophone West Africa — Orange Money, MTN, Moov, cards.'),
  ('bank_transfer', 'Bank Transfer', 'Show your bank details; mark order paid manually.'),
  ('offline', 'Offline / Cash', 'For enterprise quotes paid out-of-band.'),
  ('lemonsqueezy', 'Lemon Squeezy', 'Merchant of record for SaaS — hosted checkout, cards, global tax + subscriptions.'),
  ('ligdicash', 'LigdiCash', 'Burkina Faso / West Africa (XOF) — Orange Money, Moov Money, cards.')
  ) AS v(slug, name, description)
 WHERE g.slug = v.slug AND (g.name <> v.name OR g.description IS DISTINCT FROM v.description);
