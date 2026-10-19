/**
 * Viber's `message_token` is a 64 bit number, larger than a JavaScript number can hold exactly, and the same token comes back in the
 * `delivered` and `seen` receipts. Parsed as a number two different tokens could read the same, so the digits are kept as text before
 * the JSON is parsed.
 */
export function parseViberJson(text: string): unknown {
  return JSON.parse(text.replace(/("message_token"\s*:\s*)(\d{15,})/g, '$1"$2"'));
}

/** `parseViberJson`, or undefined when the text is not JSON. */
export function tryParseViberJson(text: string): unknown {
  try {
    return parseViberJson(text);
  } catch {
    return undefined;
  }
}
