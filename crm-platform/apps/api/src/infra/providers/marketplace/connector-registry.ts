import { Injectable } from '@nestjs/common';
import type { ConnectorKind } from '@crm/contracts';
import { OAuthConnector, EmailParseConnector } from './framework.connectors';
import { PullConnector } from './pull.connector';
import { PushConnector, WebhookRelayConnector } from './inbound.connectors';
import type { ConnectorType } from './connector.port';

/**
 * The five connector types of the framework (spec 6.3), by kind. An integration's recipe names one; the marketplace asks the registry
 * what that type can do. `implemented` is what gates publishing: a listing whose type is only a framework cannot reach a workspace.
 */
@Injectable()
export class ConnectorRegistry {
  private readonly byKind: Map<ConnectorKind, ConnectorType>;

  constructor(
    oauth: OAuthConnector,
    push: PushConnector,
    pull: PullConnector,
    emailParse: EmailParseConnector,
    webhookRelay: WebhookRelayConnector,
  ) {
    this.byKind = new Map<ConnectorKind, ConnectorType>(
      [oauth, push, pull, emailParse, webhookRelay].map((t) => [t.kind, t]),
    );
  }

  get(kind: ConnectorKind): ConnectorType {
    const t = this.byKind.get(kind);
    if (!t) throw new Error(`No connector type "${kind}" is registered`);
    return t;
  }

  all(): ConnectorType[] {
    return [...this.byKind.values()];
  }

  isImplemented(kind: ConnectorKind): boolean {
    return this.byKind.get(kind)?.implemented === true;
  }
}
