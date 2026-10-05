/**
 * Meta's pricing markets (WD-WALLET-007). Meta does not price every country: 39 stand alone on the rate card, the rest are grouped
 * into seven regions, and any country not named anywhere falls under "Other". The lists below are Meta's own, from "Country
 * calling codes" on its WhatsApp Business Platform pricing page (checked October 2026). Meta changes them rarely, so they live in
 * code; a test compares them with the market names found in the rate-card files, which fails loudly if Meta adds or renames one.
 */
export const OTHER_MARKET = 'Other';

/** Markets that are one country, by the name used in the rate card. */
export const STANDALONE_MARKETS: Readonly<Record<string, string>> = {
  Argentina: 'AR',
  Bangladesh: 'BD',
  Brazil: 'BR',
  Chile: 'CL',
  Colombia: 'CO',
  Egypt: 'EG',
  France: 'FR',
  Germany: 'DE',
  'Hong Kong': 'HK',
  Hungary: 'HU',
  India: 'IN',
  Indonesia: 'ID',
  Iraq: 'IQ',
  Israel: 'IL',
  Italy: 'IT',
  Kazakhstan: 'KZ',
  Kuwait: 'KW',
  Malaysia: 'MY',
  Mexico: 'MX',
  Morocco: 'MA',
  Netherlands: 'NL',
  Nepal: 'NP',
  Nigeria: 'NG',
  Oman: 'OM',
  Pakistan: 'PK',
  Peru: 'PE',
  Poland: 'PL',
  Qatar: 'QA',
  Romania: 'RO',
  Russia: 'RU',
  'Saudi Arabia': 'SA',
  Singapore: 'SG',
  'South Africa': 'ZA',
  Spain: 'ES',
  'Sri Lanka': 'LK',
  Turkey: 'TR',
  Ukraine: 'UA',
  'United Arab Emirates': 'AE',
  'United Kingdom': 'GB',
};

/** Markets that group several countries. */
export const REGION_MARKETS: Readonly<Record<string, readonly string[]>> = {
  'North America': ['CA', 'US'],
  'Rest of Africa': [
    'AO',
    'BF',
    'BI',
    'BJ',
    'BW',
    'CG',
    'CI',
    'CM',
    'DZ',
    'ER',
    'ET',
    'GA',
    'GH',
    'GM',
    'GW',
    'KE',
    'LR',
    'LS',
    'LY',
    'MG',
    'ML',
    'MR',
    'MW',
    'MZ',
    'NA',
    'NE',
    'RW',
    'SD',
    'SL',
    'SN',
    'SO',
    'SS',
    'SZ',
    'TD',
    'TG',
    'TN',
    'TZ',
    'UG',
    'ZM',
    'ZW',
  ],
  'Rest of Asia Pacific': [
    'AF',
    'AU',
    'CN',
    'JP',
    'KH',
    'LA',
    'MN',
    'NZ',
    'PG',
    'PH',
    'TH',
    'TJ',
    'TM',
    'TW',
    'UZ',
    'VN',
  ],
  'Rest of Central & Eastern Europe': [
    'AL',
    'AM',
    'AZ',
    'BG',
    'BY',
    'CZ',
    'GE',
    'GR',
    'HR',
    'LT',
    'LV',
    'MD',
    'MK',
    'RS',
    'SI',
    'SK',
  ],
  'Rest of Latin America': [
    'BO',
    'CR',
    'DO',
    'EC',
    'GT',
    'HN',
    'HT',
    'JM',
    'NI',
    'PA',
    'PR',
    'PY',
    'SV',
    'UY',
    'VE',
  ],
  'Rest of Middle East': ['BH', 'JO', 'LB', 'YE'],
  'Rest of Western Europe': ['AT', 'BE', 'CH', 'DK', 'FI', 'IE', 'NO', 'PT', 'SE'],
};

const COUNTRY_TO_MARKET: ReadonlyMap<string, string> = new Map([
  ...Object.entries(STANDALONE_MARKETS).map(([market, iso]) => [iso, market] as const),
  ...Object.entries(REGION_MARKETS).flatMap(([market, isos]) =>
    isos.map((iso) => [iso, market] as const),
  ),
]);

/** Every market the rate card can name. */
export const ALL_MARKETS: readonly string[] = [
  ...Object.keys(STANDALONE_MARKETS),
  ...Object.keys(REGION_MARKETS),
  OTHER_MARKET,
];

/** The market Meta prices a message to this country in. An unknown or missing country is "Other". */
export function marketOf(country: string | null | undefined): string {
  const c = (country ?? '').trim().toUpperCase();
  return COUNTRY_TO_MARKET.get(c) ?? OTHER_MARKET;
}

/** The countries a market covers, for display. "Other" is every country not named, so it has no list. */
export function countriesOf(market: string): string[] {
  const own = STANDALONE_MARKETS[market];
  if (own) return [own];
  return [...(REGION_MARKETS[market] ?? [])];
}
