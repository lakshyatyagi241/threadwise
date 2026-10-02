# Tax and invoice-money engine (`@crm/tax`)

The single implementation of money, document totals and country tax rules for proposals, estimates, invoices, credit notes and
the live preview in the web forms. Pure TypeScript, no dependency, no Node-only and no browser-only API (it uses `Intl`, which both
have, with a plain fallback). Source: `packages/tax`.

> **Disclaimer.** Rates, thresholds, ID formats, wording and rules in the presets are DEFAULTS. They were compiled from the public
> sources listed below as of the "checked" date (2026-09-01) and rates change, sometimes in-year. They are not legal, tax or
> accounting advice. The business must verify them with its accountant or tax authority before relying on them, and the UI should
> say so wherever a preset is applied. The engine never calls a live tax service.

## Design in one page

- **Money is `bigint` minor units.** No float touches an amount at any step. Strings cross the wire ("100.50"); `parseMoney` and
  `minorToMajorString` convert exactly using the ISO 4217 exponent (JPY 0, USD 2, KWD 3, CLF 4).
- **Rates are percent strings** (`"18"`, `"9.975"`, `"7.5"`), at most 4 decimals, held internally as parts-per-million, so Quebec's
  9.975% and Mexico's 10.6667% retention are exact. (Basis points cannot hold them: see "Seeding `tax_rates`".)
- **Quantities carry 4 decimals** (`qtyScaled` = qty x 10^4).
- **Rounding is an explicit, per-document setting** (`rounding: { level, mode }`):
  - `level: 'per_line'` (default): every product/ratio is rounded to a minor unit at the step that produces it; sums are exact
    sums of rounded figures, so the printed lines always add up. India and most POS systems.
  - `level: 'on_total'`: lines are carried at full precision and each document figure (subtotal, every tax group ...) is rounded
    once. Allowed in the EU (VAT per rate on the total) and REQUIRED in Japan (one rounding per rate per invoice, so the Japan
    profile defaults to it). Line figures printed on the document may then differ from the totals by a minor unit.
  - `mode`: `half_up` (default; tie away from zero, Reference's PHP `round`), `half_down`, `half_even` (banker's), `up`, `down`,
    `ceil`, `floor`.
  - Each profile states its default and whether the law dictates it (`profile.rounding`).
- **Intermediate precision** is minor units x 10^10, so qty x price x rate is exact; only divisions (extracting inclusive tax,
  pro-rata allocation) round.

## API

```ts
import {
  calculateDocument,
  resolveTaxForLine,
  taxPresetsForCountry,
  getTaxProfile,
  formatMoney,
  parseMoney,
} from '@crm/tax';
```

### Totals

`calculateDocument(input): DocumentResult` (throws `TaxMathError { path, message }`); `tryCalculateDocument(input)` returns
`{ ok, value } | { ok: false, issue }` for forms and 422 responses.

```ts
const r = calculateDocument({
  currency: 'INR',
  pricesIncludeTax: false, // default false (exclusive)
  rounding: { level: 'per_line', mode: 'half_up' },
  discount: { kind: 'percent', percent: '10' }, // document discount, spread pro rata over item lines
  cashRounding: cashRoundingFor('INR'), // optional: CHF 0.05, AUD 0.05, NZD 0.10 ... (null when none)
  payments: [50000n],
  credits: [10000n],
  lines: [
    {
      kind: 'item',
      qtyScaled: 25000n /* 2.5 */,
      unitPriceMinor: 100000n,
      discount: { kind: 'amount', minor: 5000n },
      taxes: [
        { code: 'CGST', name: 'CGST 9%', rate: '9' },
        { code: 'SGST', name: 'SGST 9%', rate: '9' },
        { code: 'TDS_194J_10', name: 'TDS 10%', rate: '10', category: 'withholding' },
      ],
    },
    { kind: 'shipping', unitPriceMinor: 5000n }, // not discounted unless `discountable: true`
    { kind: 'adjustment', unitPriceMinor: -200n }, // the only kind that may be negative
  ],
});
```

Per line: `taxes[]` (additive by default; `compound: true` charges that tax on price + the taxes before it; `category: 'withholding'`
or a negative rate is a TDS-style deduction charged on the ex-tax amount that reduces what is payable, not the invoice total);
`taxInclusive` overrides the document's price mode.

`DocumentResult` (all minor units): `lines[]` (`grossMinor`, `discountMinor`, `netMinor`, `sharedDiscountMinor`, `taxableMinor`,
`taxes[]`, `taxMinor`, `withholdingMinor`, `totalMinor`), `subtotalMinor` (item nets before the document discount),
`discountMinor` (document discount, clamped to the subtotal), `shippingMinor`, `adjustmentMinor`, `taxableMinor`, `taxMinor`
(all positive taxes), `taxAddedMinor` (exclusive only), `taxSummary[]` (footer rows grouped by code + rate + inclusive, with
`baseMinor` excluding the tax), `withholdingMinor`, `withholdingSummary[]`, `totalBeforeRoundingMinor`, `roundingMinor`
(the cash-rounding adjustment line), `totalMinor`, `payableMinor` (= total - withholding), `paidMinor`, `creditedMinor`,
`amountDueMinor`, `overpaidMinor`, `paymentStatus` (`unpaid | partially_paid | paid | overpaid`).

Identities (all property-tested on 4,000 random documents): `taxable = subtotal - discount + shipping + adjustment`;
`total = taxable + taxAdded + rounding`; the shares of the document discount add back to it exactly (largest remainder, ties to
the earlier line); in `per_line` every document figure is the exact sum of the line figures; for an inclusive line
`net + tax == the price the buyer pays` always.

Helpers: `netFromGross(gross, taxes)`, `grossFromNet(net, taxes)`, `settle({ payableMinor, payments, credits })`,
`allocate(total, weights)`, `divRound(n, d, mode)`, `roundToMultiple`, `applyCashRounding`.

### Money and formatting

`currencyExponent(code)`, `minorPerMajor`, `isKnownCurrency`, `parseMoney`, `minorToMajorString`, `parseQty/formatQty`,
`parseRate/formatRate`, `bpToPercent/percentToBp`, `formatMoney(minor, currency, { locale, display, trimWholeDecimals })`
(`Intl` with the ISO exponent pinned; en-IN gives lakh grouping), `formatDecimalLocale`.

### Country profiles

`getTaxProfile('IN' | 'GB' | 'DE' ... 'CUSTOM')` (also accepts `UK`, `EL`; `taxProfileOrCustom(code)` never returns undefined),
`TAX_PROFILES` (48). A profile carries `rates` (effective-dated rows), `withholding` rows, `sellerTaxId` / `buyerTaxId`
(`spec.validate(raw)`, requirement), `documentTitles`, `checklist`, `fiscalYear`, `numbering`, `rounding`, `regions`, `notes`,
`sources` and `resolve()`.

**ID validators** return `{ valid, normalized, level: 'checksum' | 'format', reason, details }`: `validateGstin` (state code, PAN,
mod-36 check char), `validatePan`, `validateUkVat` (mod-97 incl. GD/HA), `validateEuVatId(raw, country?)` (VIES prefixes incl. EL;
check digits for DE, FR, IT, BE, PL; format for the rest), `validateAbn`, `validateNzIrd`, `validateCaGstHst` (Luhn),
`validateCaQst`, `validateJpInvoiceNo` (T + corporate number check digit), `validateCnpj`, `validateMexRfc`, `validateSgGst`,
`validateMySst`, `validateUaeTrn`, `validateSaudiVat`, `validateBahrainVat`, `validateOmanVat`, `validateZaVat`, `validateNgTin`,
`validateKePin`, `validateUsEin`. A valid result does not prove the number is registered: use VIES, the GST portal, ABN Lookup ...

**`resolveTaxForLine`**: which taxes apply to a line, and why ("Why this tax?"):

```ts
const res = resolveTaxForLine({
  sellerProfile: 'IN', // profile or country code
  seller: { region: 'MH', taxId: '27AAPFU0939F1ZV', scheme: 'regular', registeredRegions: [] },
  buyer: {
    country: 'IN',
    region: 'KA',
    type: 'business',
    taxId: '29AABCT1332L1ZA',
    taxExempt: false,
    isSez: false,
  },
  product: { category: 'standard', code: '998314', ratePercent: 18, reverseCharge: false },
  supplyType: 'services', // goods | services | digital
  date: '2026-10-02', // rates are effective-dated; default today
  overrideRatePercent: undefined, // manual rate (US combined local rate ...)
  withholdingCodes: ['TDS_194J_10'],
});
// res.taxes -> LineInput.taxes ; res.reasons / res.warnings -> the "Why this tax?" panel ; res.documentNotes -> printed wording
// res.placeOfSupply, res.reverseCharge, res.taxFree, res.documentTypeHint ('bill_of_supply' ...)
```

Rule coverage (each tested): India intra-state CGST+SGST (UTGST in UTs without legislature) vs inter-state/SEZ IGST, place of
supply (goods = ship-to state; services to a registered business = state of the buyer GSTIN), exports under LUT, composition
scheme, reverse charge, exempt/nil, TDS/TCS; UAE/Saudi/Bahrain/Oman exports and exemptions; UK 20/5/0, export, B2B-services outside
scope, domestic reverse charge, flat-rate warning, CIS; EU domestic by category, intra-EU B2B reverse charge (VAT ID validated),
B2C below threshold (seller rate) vs OSS (destination rate), non-EU export; US state base rate, nexus, exempt customers, manual
override, services not taxed by default; Canada GST/HST/PST/QST by buyer province with PST/QST only when registered;
AU/NZ/SG/ZA/NG/KE/JP exports; Malaysia sales vs service tax; Mexico IVA and retentions; Brazil/Qatar/Kuwait note-only; `CUSTOM`.

**Compliance checklist**: `applicableChecklist(profile, ctx)` lists what must be on an invoice for that country and situation
(b2b, reverse charge, export, inter-state, composition, above-threshold ...); `checkInvoiceCompliance(profile, { fields }, ctx)`
returns what is missing or has the wrong mandatory wording ("TAX INVOICE", "BILL OF SUPPLY", "Reverse charge").

**Financial year and invoice numbers**: `fiscalYearOf(date, profile.fiscalYear)` (India 1 Apr; UK 6 Apr; NZ 1 Apr; ZA 1 Mar;
Japan 1 Apr; default 1 Jan), `formatInvoiceNumber`, `sequenceScope`, `nextInvoiceNumber(rules, fy, { date, state })` (reset by
`never | yearly | fiscal_year | monthly`), `validateInvoiceNumber` (India: max 16 chars, letters, digits, `-` `/`; the default
`INV/2026-27/0001` is exactly 16).

### Seeding `tax_rates`

`taxPresetsForCountry(code, { asOf?, includeHistorical?, includeWithholding? }): TaxPresetRow[]` returns rows ready to
bulk-create into the invoices `tax_rates` table (name <= 60 chars, `rateBp`, `inclusive`, `isDefault`) plus `ratePercent`,
`type`, `category`, `effectiveFrom/To`, `region`, `description` and, for India, `components` (the CGST/SGST/IGST split of a
combined slab). This package does not write to the database. A seed maps `name -> name`, `rateBp -> rate_bp`,
`inclusive -> inclusive`, `isDefault -> is_default`, `description -> description`.

**Known gap:** `tax_rates.rate_bp` is an integer with `CHECK (rate_bp BETWEEN 0 AND 10000)`. Rates with more than 2 decimals of a
percent cannot be held exactly: Quebec QST 9.975%, Mexican IVA retention 10.6667%, and four US state bases (MN 6.875, MO 4.225,
NJ 6.625, NM 4.875). Those rows have `rateBpExact: false` (their `rateBp` is rounded). Either skip them in the seed, or add a
`rate_percent numeric(7,4)` column (recommended; the engine already takes percent strings).

## Presets (checked 2026-09-01)

Defaults in force on 2026-10-02. "FY" is the default financial-year start (day/month). Each country also has effective-dated
history rows (e.g. India's 12% and 28% slabs end 2025-09-21; Saudi 5% ended 2020-06-30; Estonia 22% -> 24% on 2025-07-01).
Reduced and special rates are selected through the product category or an explicit rate.

| Code   | Country              | Rates                                              | Seller tax ID                  | Rounding default | FY  | Primary source                              |
| ------ | -------------------- | -------------------------------------------------- | ------------------------------ | ---------------- | --- | ------------------------------------------- |
| IN     | India                | GST 18 / 5 / 40 / 3 / 0.25 / 0 (CGST+SGST or IGST) | GSTIN                          | per_line         | 1/4 | CBIC GST rates and notifications            |
| AE     | United Arab Emirates | 5%                                                 | TRN                            | per_line         | 1/1 | UAE Federal Tax Authority: VAT guide        |
| SA     | Saudi Arabia         | 15%                                                | VAT registration number        | per_line         | 1/1 | ZATCA: VAT                                  |
| BH     | Bahrain              | 10%                                                | VAT account number             | per_line         | 1/1 | Bahrain National Bureau for Revenue         |
| OM     | Oman                 | 5%                                                 | VATIN                          | per_line         | 1/1 | Oman Tax Authority                          |
| QA     | Qatar                | none                                               | -                              | per_line         | 1/1 | General Tax Authority, Qatar                |
| KW     | Kuwait               | none                                               | -                              | per_line         | 1/1 | Kuwait Ministry of Finance                  |
| GB     | United Kingdom       | 20% / 5%                                           | VAT registration number        | per_line         | 6/4 | HMRC: VAT rates                             |
| AT     | Austria              | 20% / 10% / 13%                                    | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| BE     | Belgium              | 21% / 6% / 12%                                     | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| BG     | Bulgaria             | 20% / 9%                                           | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| HR     | Croatia              | 25% / 13% / 5%                                     | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| CY     | Cyprus               | 19% / 9% / 5%                                      | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| CZ     | Czechia              | 21% / 12%                                          | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| DK     | Denmark              | 25%                                                | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| EE     | Estonia              | 24% / 9% / 13%                                     | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| FI     | Finland              | 25.5% / 14% / 10%                                  | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| FR     | France               | 20% / 10% / 5.5% / 2.1%                            | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| DE     | Germany              | 19% / 7%                                           | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| GR     | Greece               | 24% / 13% / 6%                                     | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| HU     | Hungary              | 27% / 5% / 18%                                     | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| IE     | Ireland              | 23% / 13.5% / 9% / 4.8%                            | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| IT     | Italy                | 22% / 10% / 5% / 4%                                | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| LV     | Latvia               | 21% / 12% / 5%                                     | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| LT     | Lithuania            | 21% / 9% / 5%                                      | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| LU     | Luxembourg           | 17% / 8% / 3%                                      | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| MT     | Malta                | 18% / 7% / 5%                                      | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| NL     | Netherlands          | 21% / 9%                                           | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| PL     | Poland               | 23% / 8% / 5%                                      | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| PT     | Portugal             | 23% / 13% / 6%                                     | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| RO     | Romania              | 21% / 11%                                          | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| SK     | Slovakia             | 23% / 19% / 5%                                     | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| SI     | Slovenia             | 22% / 9.5% / 5%                                    | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| ES     | Spain                | 21% / 10% / 4%                                     | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| SE     | Sweden               | 25% / 12% / 6%                                     | VAT identification number      | per_line         | 1/1 | European Commission: VAT rates              |
| US     | United States        | state base rates 0-7.25% (51 rows)                 | EIN                            | per_line         | 1/1 | Tax Foundation: state sales tax rates       |
| CA     | Canada               | GST 5%; HST 13/14/15%; PST 6-7%; QST 9.975%        | GST/HST number                 | per_line         | 1/1 | Canada Revenue Agency: GST/HST rates        |
| AU     | Australia            | 10%                                                | ABN                            | per_line         | 1/1 | Australian Taxation Office: tax invoices    |
| NZ     | New Zealand          | 15%                                                | GST number (IRD)               | per_line         | 1/4 | Inland Revenue: tax invoices                |
| SG     | Singapore            | 9%                                                 | GST registration number / UEN  | per_line         | 1/1 | IRAS: GST                                   |
| MY     | Malaysia             | sales 10/5%, service 8/6%                          | SST registration number        | per_line         | 1/1 | Royal Malaysian Customs: SST                |
| ZA     | South Africa         | 15%                                                | VAT number                     | per_line         | 1/3 | SARS: VAT                                   |
| NG     | Nigeria              | 7.5%                                               | TIN                            | per_line         | 1/1 | Federal Inland Revenue Service              |
| KE     | Kenya                | 16%                                                | KRA PIN                        | per_line         | 1/7 | Kenya Revenue Authority                     |
| MX     | Mexico               | 16% / 8%                                           | RFC                            | per_line         | 1/1 | SAT (Servicio de Administracion Tributaria) |
| BR     | Brazil               | none                                               | CNPJ                           | per_line         | 1/1 | Receita Federal                             |
| JP     | Japan                | 10% / 8%                                           | Registration number (T number) | on_total (law)   | 1/4 | National Tax Agency: consumption tax        |
| CUSTOM | Custom               | none                                               | -                              | per_line         | 1/1 |                                             |

Other sources: CGST Rules 2017 Rule 46 and Income Tax Act Chapter XVII-B (India), ZATCA e-invoicing rules, UK HMRC VAT invoices
guidance, VIES, Streamlined Sales Tax Governing Board, Revenu Quebec, NZ Inland Revenue, IRAS, MyInvois. Every profile lists its
sources and dates in `profile.sources`.

Notes that matter for small businesses (full text in each `profile.notes`):

- India: GST slabs simplified 22 Sep 2025 (5%, 18%, 40%); composition dealers issue a Bill of Supply; HSN 4/6 digits by turnover;
  e-invoicing (IRN) above the turnover limit is NOT generated by this engine; the HSN-to-rate table is not shipped (store the
  rate on the product).
- Gulf: Saudi ZATCA e-invoicing (XML, QR, clearance) is not generated; Qatar and Kuwait have no VAT in the preset.
- UK: B2B services abroad are outside the scope; flat-rate scheme invoices still show standard VAT.
- EU: below the EUR 10,000 EU-wide B2C threshold use the seller's rate; above it register for OSS and set `scheme: 'oss'`.
  Reduced-rate eligibility differs by country: the engine only knows the rate, not which goods qualify. Special territories
  (Canary Islands, Madeira, Azores, Corsica ...) are not modelled.
- US: state BASE rates only; local rates, product taxability and economic-nexus thresholds are the user's call (override).
- Canada: PST/QST are charged only when the seller is registered in that province (`seller.registeredRegions`).
- Brazil: no automatic tax; a legal Brazilian invoice is an authorised NF-e/NFS-e, which this app cannot issue.

## How to add a country

1. Pick the shape. Single-rate VAT/GST: copy a block in `src/profiles/countries/simple.ts` (it calls `makeSimpleResolver` with
   the rate codes, how exports and foreign B2B services are treated, and the "not registered" wording). Anything with
   place-of-supply rules gets its own file (see `india.ts`, `canada.ts`, `eu.ts`).
2. Add the effective-dated `rates` (`rate(code, name, type, category, ratePercent, effectiveFrom, { effectiveTo })`). Never edit
   an old rate: end it with `effectiveTo` and add a new row, so old documents re-price identically. Rows with the same `code`
   and `region` must not overlap (a test checks it).
3. Add the ID validator to `validators.ts` (`level: 'checksum'` only if you verified a public algorithm against real numbers)
   and its `ID_SPECS` entry with an example that validates (a test checks it).
4. Fill `checklist` (use `commonChecklist`), `documentTitles`, `fiscalYear`, `numbering` rules (limits the law sets),
   `rounding` (and `dictatedByLaw`), `notes` and `sources` with the date you checked them.
5. Register it in `src/profiles/registry.ts`, add a describe block to `src/profiles/profiles.spec.ts` with a golden fixture
   (resolve then `calculateDocument`) and update the profile-count assertion.
6. `pnpm --filter @crm/tax build lint typecheck test`.

## Adoption state

- **Done.** `@crm/contracts` now delegates its two money functions to this package: `calculateSalesDoc`
  (`packages/contracts/src/sales-docs/money.ts`, used by proposals and estimates, the API and the web form preview) and
  `calculateInvoice` (`packages/contracts/src/invoicing/invoice-math.ts`, used by the invoices API and the web preview). Their
  signatures and results are unchanged. Parity was verified before the swap by a differential run of the old in-file code against
  the engine on 60,000 random documents (discounts, mixed rates, inclusive and exclusive lines, shipping, names): identical
  output including error paths. The API unit tests (invoice-math, sales-doc-money, invoice-render ...) and the web totals tests
  pass. `@crm/tax` is a dependency of `@crm/contracts`, `@crm/api` and `@crm/web`; CI and `apps/api/Dockerfile` build it first.
- **Next steps for the two feature owners** (not done here because their code is still moving):
  1. Per-line tax components. The engine already splits a line into several taxes (`taxes: [CGST, SGST]`, GST + QST) and
     reports each component's base and amount. `calculateInvoice` still takes one `taxRateBp` per line; call `calculateDocument`
     directly when a line has components, and store `rounding.level` on the document.
  2. Call `resolveTaxForLine` when a line's product or the customer changes, and show `reasons`/`warnings` as "Why this tax?".
  3. Seed `tax_rates` from `taxPresetsForCountry(org.country)` on org creation (see the `rate_bp` gap above).
  4. Make `currencyExponent` in `packages/contracts/src/deals-pipelines/money.ts` re-export the one from `@crm/tax` (identical
     tables except CLF and UYW, which are 4-decimal in ISO 4217).
  5. Use `formatMoney` for display (Reference divided by 100 for every currency).
  6. Offer the profile's rounding default (`profile.rounding`) as the per-document setting, print the footer from `taxSummary`
     (base, rate, tax) and `roundingMinor` as a "Rounding" line.

## Tests

`pnpm --filter @crm/tax test`: money and rounding (every mode, allocation properties, exponents JPY/USD/KWD/CLF, parse/format
round trips, cash rounding), totals golden fixtures and 4,000 random documents checking the rounding invariants, validators with
real-format valid and invalid numbers, every country resolver, effective-dated rates, preset integrity (no overlaps, fits the
`tax_rates` table), fiscal years, invoice numbers and the compliance checklist.
