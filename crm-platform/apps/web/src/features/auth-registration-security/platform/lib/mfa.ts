/** "JBSWY3DPEHPK3PXP" -> "JBSW Y3DP EHPK 3PXP": easier to read aloud and to type from a screen. */
export function formatSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

/** The text of the downloadable recovery-codes file: a header line, then one code per line. */
export function recoveryCodesFile(header: string, codes: readonly string[]): string {
  return `${header}\n\n${codes.join('\n')}\n`;
}
