/**
 * Country calling codes (ITU E.164), 1 to 3 digits. The plan is prefix-free: once a code matches,
 * no longer code starts with it, so the first match from the front of an E.164 number is the code.
 * Kept as plain data so the API needs no phone library just to show "+971 •••• ••21".
 */
const ONE_DIGIT = new Set(['1', '7']);
const TWO_DIGITS = new Set(
  (
    '20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 ' +
    '64 65 66 81 82 84 86 90 91 92 93 94 95 98'
  ).split(' '),
);
const THREE_DIGITS = new Set(
  (
    '211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 ' +
    '238 239 240 241 242 243 244 245 246 247 248 249 250 251 252 253 254 255 256 257 258 260 261 ' +
    '262 263 264 265 266 267 268 269 290 291 297 298 299 350 351 352 353 354 355 356 357 358 359 ' +
    '370 371 372 373 374 375 376 377 378 380 381 382 383 385 386 387 389 420 421 423 500 501 502 ' +
    '503 504 505 506 507 508 509 590 591 592 593 594 595 596 597 598 599 670 672 673 674 675 676 ' +
    '677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 850 852 853 855 856 880 886 960 ' +
    '961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 992 993 994 995 996 998'
  ).split(' '),
);

/** The calling code of an E.164 number ("+971501234567" -> "971"), or null when none matches. */
export function callingCodeOf(e164: string): string | null {
  const digits = e164.replace(/\D/g, '');
  if (ONE_DIGIT.has(digits.slice(0, 1))) return digits.slice(0, 1);
  if (TWO_DIGITS.has(digits.slice(0, 2))) return digits.slice(0, 2);
  if (THREE_DIGITS.has(digits.slice(0, 3))) return digits.slice(0, 3);
  return null;
}

/**
 * "+91 •••• ••21": the real calling code and the last two digits, nothing else. A number whose code
 * is not in the table (a typo that passed the length check) shows only its first digit.
 */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  const code = callingCodeOf(digits) ?? digits.slice(0, 1);
  return `+${code} •••• ••${digits.slice(-2)}`;
}
