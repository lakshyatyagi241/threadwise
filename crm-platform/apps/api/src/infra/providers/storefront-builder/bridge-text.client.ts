/**
 * Sends one plain-text WhatsApp message through the Node bridge that holds the unofficial (QR-paired) sessions:
 * `POST {bridge}/api/send-message/{senderNumber}` with `X-Node-Token`, the same call the OTP sender makes.
 */
export interface BridgeTextPort {
  /** Throws with a readable reason when the bridge refuses or is unreachable. */
  sendText(input: { to: string; fromDigits: string; body: string }): Promise<void>;
}

export const BRIDGE_TEXT_PORT = Symbol('STORE_BRIDGE_TEXT_PORT');

const TIMEOUT_MS = 20_000;

export class HttpBridgeTextClient implements BridgeTextPort {
  constructor(
    private readonly bridgeUrl: string | null,
    private readonly token: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendText(input: { to: string; fromDigits: string; body: string }): Promise<void> {
    if (!this.bridgeUrl || !this.token) {
      throw new Error(
        'The WhatsApp bridge is not configured (BAILEYS_SERVER_URL, BAILEYS_NODE_TOKEN).',
      );
    }
    const res = await this.fetchImpl(
      `${this.bridgeUrl}/api/send-message/${encodeURIComponent(input.fromDigits)}`,
      {
        method: 'POST',
        headers: { 'X-Node-Token': this.token, 'content-type': 'application/json' },
        body: JSON.stringify({
          targetPhoneNumber: input.to.replace(/\D+/g, ''),
          message: input.body,
        }),
        // The token must not follow a redirect to another host.
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const json = (await res.json().catch(() => undefined)) as { success?: boolean } | undefined;
    if (!res.ok || json?.success === false) {
      throw new Error(`The WhatsApp bridge refused the message (HTTP ${res.status}).`);
    }
  }
}
