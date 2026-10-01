/** Groups a base32 secret in fours for reading aloud and typing: "ABCD EFGH IJKL". */
export function groupSecret(secret: string): string {
  return secret
    .replace(/\s+/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim();
}
