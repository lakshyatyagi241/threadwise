import {
  CatalogProviderError,
  type BaileysCard,
  type BaileysCatalogBridge,
  type SentMessage,
} from './catalog-provider.port';

const CAROUSEL_TIMEOUT_MS = 60_000;
const TEXT_TIMEOUT_MS = 30_000;

export interface HttpBridgeOptions {
  /** `BAILEYS_SERVER_URL`: Reference's `baileys_server_url` setting, else `SERVER_URL`, default `http://localhost:8888`. */
  baseUrl: string;
  /** `X-Node-Token`, when the bridge asks for one. */
  token?: string;
  fetchImpl?: typeof fetch;
  carouselTimeoutMs?: number;
  textTimeoutMs?: number;
}

/**
 * The Node bridge over HTTP: the two endpoints Reference posted to (`/api/send-product-catalog/{phone}` and
 * `/api/send-message/{phone}`). It cannot be run here (no paired WhatsApp session); the unit tests check the payload it sends
 * and how it reads a failure.
 */
export class HttpBaileysCatalogBridge implements BaileysCatalogBridge {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: HttpBridgeOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async post(
    path: string,
    body: unknown,
    timeoutMs: number,
    what: string,
  ): Promise<SentMessage> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/+$/, '')}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(this.opts.token ? { 'X-Node-Token': this.opts.token } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new CatalogProviderError(
        `${what} failed: could not reach the WhatsApp bridge (${err instanceof Error ? err.message : 'request failed'})`,
        'network',
      );
    }
    let json: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(await res.text());
      if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>;
    } catch {
      json = {};
    }
    if (!res.ok || json.success === false) {
      const detail = typeof json.error === 'string' && json.error ? json.error : String(res.status);
      throw new CatalogProviderError(`${what} failed: ${detail}`, 'meta', {
        code: res.status,
        subcode: null,
        httpStatus: res.status,
        raw: detail,
      });
    }
    const id = json.messageId;
    return { messageId: typeof id === 'string' ? id : null, raw: json };
  }

  sendCarousel(input: {
    senderPhone: string;
    to: string;
    cards: readonly BaileysCard[];
    headerText: string;
    bodyText: string;
    footerText: string;
  }): Promise<SentMessage> {
    if (input.cards.length === 0) {
      return Promise.reject(new CatalogProviderError('No products to send.', 'config'));
    }
    return this.post(
      `/api/send-product-catalog/${encodeURIComponent(input.senderPhone)}`,
      {
        json: {
          targetPhoneNumber: input.to,
          products: input.cards,
          type: input.cards.length === 1 ? 'single' : 'multi',
          header_text: input.headerText,
          body_text: input.bodyText,
          footer_text: input.footerText,
          section_title: 'Products',
        },
      },
      this.opts.carouselTimeoutMs ?? CAROUSEL_TIMEOUT_MS,
      'Baileys carousel',
    );
  }

  sendText(input: { senderPhone: string; to: string; text: string }): Promise<SentMessage> {
    return this.post(
      `/api/send-message/${encodeURIComponent(input.senderPhone)}`,
      { targetPhoneNumber: input.to, message: input.text },
      this.opts.textTimeoutMs ?? TEXT_TIMEOUT_MS,
      'Baileys link send',
    );
  }

  sendImage(input: {
    senderPhone: string;
    to: string;
    imageUrl: string;
    caption: string;
  }): Promise<SentMessage> {
    return this.post(
      `/api/send-media-message/${encodeURIComponent(input.senderPhone)}`,
      {
        json: {
          targetPhoneNumber: input.to,
          file: input.imageUrl,
          filetype: 'image/jpeg',
          caption: input.caption,
        },
      },
      this.opts.textTimeoutMs ?? TEXT_TIMEOUT_MS,
      'Baileys image send',
    );
  }
}
