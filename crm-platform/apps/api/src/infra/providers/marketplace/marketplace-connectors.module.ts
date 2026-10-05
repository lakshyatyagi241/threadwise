import { Module } from '@nestjs/common';
import { ConnectorRegistry } from './connector-registry';
import { EmailParseConnector, OAuthConnector } from './framework.connectors';
import { PushConnector, WebhookRelayConnector } from './inbound.connectors';
import { PullConnector } from './pull.connector';

/** The connector framework's adapters: the five types and their registry. Imported by the marketplace module. */
@Module({
  providers: [
    OAuthConnector,
    PushConnector,
    PullConnector,
    EmailParseConnector,
    WebhookRelayConnector,
    ConnectorRegistry,
  ],
  exports: [ConnectorRegistry],
})
export class MarketplaceConnectorsModule {}
