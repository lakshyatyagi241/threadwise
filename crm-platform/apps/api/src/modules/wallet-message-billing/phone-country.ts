/**
 * Recipient country from a phone number (WD-WALLET-004 rule 3). WhatsApp prices by the RECIPIENT's country, which the dialling
 * code decides. No libphonenumber: a prefix table, longest prefix first (3, then 2, then 1 digits), plus the North American area
 * codes that belong to a country other than the US. An unknown prefix is `null` and prices at the default row.
 */

// 1-digit and 2-digit and 3-digit calling codes -> one ISO code each (the representative country of a shared code).
const DIAL: Record<string, string> = {
  '1': 'US',
  '7': 'RU',
  '20': 'EG',
  '27': 'ZA',
  '30': 'GR',
  '31': 'NL',
  '32': 'BE',
  '33': 'FR',
  '34': 'ES',
  '36': 'HU',
  '39': 'IT',
  '40': 'RO',
  '41': 'CH',
  '43': 'AT',
  '44': 'GB',
  '45': 'DK',
  '46': 'SE',
  '47': 'NO',
  '48': 'PL',
  '49': 'DE',
  '51': 'PE',
  '52': 'MX',
  '53': 'CU',
  '54': 'AR',
  '55': 'BR',
  '56': 'CL',
  '57': 'CO',
  '58': 'VE',
  '60': 'MY',
  '61': 'AU',
  '62': 'ID',
  '63': 'PH',
  '64': 'NZ',
  '65': 'SG',
  '66': 'TH',
  '81': 'JP',
  '82': 'KR',
  '84': 'VN',
  '86': 'CN',
  '90': 'TR',
  '91': 'IN',
  '92': 'PK',
  '93': 'AF',
  '94': 'LK',
  '95': 'MM',
  '98': 'IR',
  '211': 'SS',
  '212': 'MA',
  '213': 'DZ',
  '216': 'TN',
  '218': 'LY',
  '220': 'GM',
  '221': 'SN',
  '222': 'MR',
  '223': 'ML',
  '224': 'GN',
  '225': 'CI',
  '226': 'BF',
  '227': 'NE',
  '228': 'TG',
  '229': 'BJ',
  '230': 'MU',
  '231': 'LR',
  '232': 'SL',
  '233': 'GH',
  '234': 'NG',
  '235': 'TD',
  '236': 'CF',
  '237': 'CM',
  '238': 'CV',
  '239': 'ST',
  '240': 'GQ',
  '241': 'GA',
  '242': 'CG',
  '243': 'CD',
  '244': 'AO',
  '245': 'GW',
  '246': 'IO',
  '248': 'SC',
  '249': 'SD',
  '250': 'RW',
  '251': 'ET',
  '252': 'SO',
  '253': 'DJ',
  '254': 'KE',
  '255': 'TZ',
  '256': 'UG',
  '257': 'BI',
  '258': 'MZ',
  '260': 'ZM',
  '261': 'MG',
  '262': 'RE',
  '263': 'ZW',
  '264': 'NA',
  '265': 'MW',
  '266': 'LS',
  '267': 'BW',
  '268': 'SZ',
  '269': 'KM',
  '290': 'SH',
  '291': 'ER',
  '297': 'AW',
  '298': 'FO',
  '299': 'GL',
  '350': 'GI',
  '351': 'PT',
  '352': 'LU',
  '353': 'IE',
  '354': 'IS',
  '355': 'AL',
  '356': 'MT',
  '357': 'CY',
  '358': 'FI',
  '359': 'BG',
  '370': 'LT',
  '371': 'LV',
  '372': 'EE',
  '373': 'MD',
  '374': 'AM',
  '375': 'BY',
  '376': 'AD',
  '377': 'MC',
  '378': 'SM',
  '380': 'UA',
  '381': 'RS',
  '382': 'ME',
  '383': 'XK',
  '385': 'HR',
  '386': 'SI',
  '387': 'BA',
  '389': 'MK',
  '420': 'CZ',
  '421': 'SK',
  '423': 'LI',
  '500': 'FK',
  '501': 'BZ',
  '502': 'GT',
  '503': 'SV',
  '504': 'HN',
  '505': 'NI',
  '506': 'CR',
  '507': 'PA',
  '509': 'HT',
  '590': 'GP',
  '591': 'BO',
  '592': 'GY',
  '593': 'EC',
  '594': 'GF',
  '595': 'PY',
  '596': 'MQ',
  '597': 'SR',
  '598': 'UY',
  '670': 'TL',
  '673': 'BN',
  '674': 'NR',
  '675': 'PG',
  '676': 'TO',
  '677': 'SB',
  '678': 'VU',
  '679': 'FJ',
  '685': 'WS',
  '852': 'HK',
  '853': 'MO',
  '855': 'KH',
  '856': 'LA',
  '880': 'BD',
  '886': 'TW',
  '960': 'MV',
  '961': 'LB',
  '962': 'JO',
  '963': 'SY',
  '964': 'IQ',
  '965': 'KW',
  '966': 'SA',
  '967': 'YE',
  '968': 'OM',
  '970': 'PS',
  '971': 'AE',
  '972': 'IL',
  '973': 'BH',
  '974': 'QA',
  '975': 'BT',
  '976': 'MN',
  '977': 'NP',
  '992': 'TJ',
  '993': 'TM',
  '994': 'AZ',
  '995': 'GE',
  '996': 'KG',
  '998': 'UZ',
};

/** North American numbering plan: a +1 number belongs to the country its 3-digit area code names; unlisted codes are the US. */
const NANP_AREAS: Record<string, string> = {};
function nanp(country: string, codes: string): void {
  for (const c of codes.split(' ')) NANP_AREAS[c] = country;
}
nanp(
  'CA',
  '204 226 236 249 250 263 289 306 343 354 365 367 368 382 403 416 418 428 431 437 438 450 468 474 506 514 519 548 579 581 584 587 604 613 639 647 672 683 705 709 742 778 780 782 807 819 825 867 873 879 902 905',
);
nanp('PR', '787 939');
nanp('DO', '809 829 849');
nanp('JM', '658 876');
nanp('BS', '242');
nanp('BB', '246');
nanp('TT', '868');
nanp('BM', '441');
nanp('KY', '345');
nanp('AG', '268');
nanp('DM', '767');
nanp('GD', '473');
nanp('KN', '869');
nanp('LC', '758');
nanp('VC', '784');
nanp('SX', '721');
nanp('TC', '649');
nanp('VG', '284');
nanp('VI', '340');
nanp('GU', '671');
nanp('AS', '684');
nanp('MP', '670');
nanp('AI', '264');
nanp('MS', '664');

/** Kazakhstan shares +7 with Russia and is told apart by its 6xx and 7xx mobile/area ranges. */
const KZ_PREFIXES = ['6', '7'];

export function phoneDigits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

/** ISO alpha-2 of the recipient, or null when the prefix is unknown. */
export function countryOfPhone(phone: string | null | undefined): string | null {
  let digits = phoneDigits(phone);
  // International dialling prefix typed as 00.
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 7) return null;
  if (digits.startsWith('1') && digits.length >= 4) {
    return NANP_AREAS[digits.slice(1, 4)] ?? 'US';
  }
  if (digits.startsWith('7') && digits.length >= 2 && KZ_PREFIXES.includes(digits.slice(1, 2))) {
    return 'KZ';
  }
  for (const len of [3, 2, 1]) {
    const hit = DIAL[digits.slice(0, len)];
    if (hit) return hit;
  }
  return null;
}

/** Every ISO 3166-1 alpha-2 code the picker offers. */
export const ISO_COUNTRIES = (
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ ' +
  'OM PA PE PF PG PH PK PL PM PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
).split(' ');

let names: Intl.DisplayNames | null = null;
/** English country name of an ISO code; the code itself when the runtime does not know it. */
export function countryName(code: string): string {
  if (!code) return '';
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

export function countryList(): Array<{ code: string; name: string }> {
  return ISO_COUNTRIES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

const ALIASES: Record<string, string> = {
  usa: 'US',
  'united states of america': 'US',
  america: 'US',
  uk: 'GB',
  'great britain': 'GB',
  england: 'GB',
  uae: 'AE',
  'united arab emirates': 'AE',
  korea: 'KR',
  'south korea': 'KR',
  'republic of korea': 'KR',
  russia: 'RU',
  'russian federation': 'RU',
  vietnam: 'VN',
  'viet nam': 'VN',
  'ivory coast': 'CI',
  "cote d'ivoire": 'CI',
  "côte d'ivoire": 'CI',
  czechia: 'CZ',
  'czech republic': 'CZ',
  turkey: 'TR',
  turkiye: 'TR',
  türkiye: 'TR',
};

/**
 * What an import cell may say for a country (WD-WALLET-004 rule 9): an ISO code, a name or alias, or a calling code ("1", "+91").
 * `''` = any country (blank or `*`); `null` = not understood.
 */
export function resolveCountry(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (raw === '' || raw === '*') return '';
  // "UK" is not an ISO code but is what people write: the aliases come before the 2-letter rule.
  const alias = ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  if (/^[A-Za-z]{2}$/.test(raw)) {
    const code = raw.toUpperCase();
    return ISO_COUNTRIES.includes(code) ? code : null;
  }
  if (/^\+?\d{1,4}$/.test(raw)) {
    const digits = raw.replace('+', '');
    return DIAL[digits] ?? null;
  }
  const key = raw.toLowerCase();
  for (const code of ISO_COUNTRIES) {
    if (countryName(code).toLowerCase() === key) return code;
  }
  return null;
}
