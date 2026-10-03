import { Injectable } from '@nestjs/common';
import {
  MARKET_HOOK_SIGNATURE_HEADER,
  MARKET_HOOK_TOKEN_HEADER,
  type MarketRecipe,
} from '@crm/contracts';
import type {
  ConnectorContext,
  ConnectorProblem,
  ConnectorTestResult,
  InboundConnectorType,
  InboundRequest,
} from './connector.port';
import { signatureMatches, tokenMatches } from './hook-auth';
import { mapDelivery } from './recipe-mapper';

/** Runs the recipe's own sample through its mapping: the "test connection" of a type that receives deliveries (no network involved). */
function testSample(ctx: ConnectorContext): ConnectorTestResult {
  const sample = ctx.recipe.testPayloads[0];
  if (!sample) {
    return {
      ok: true,
      code: null,
      message: 'The recipe has no sample payload; the address is ready for deliveries.',
    };
  }
  const { leads, rejected } = mapDelivery(ctx.recipe, sample.payload);
  if (leads.length === 0) {
    return {
      ok: false,
      code: 'sample_unmapped',
      message: `The sample "${sample.name}" produced no lead${rejected[0] ? ` (${rejected[0].reason})` : ''}.`,
    };
  }
  return { ok: true, code: null, message: null };
}

/**
 * Webhook relay (Zapier, Make, any tool that posts to an address): the platform generates the connection's secret and the sender repeats it
 * in a header or signs the body with it. The mapping is `auto` unless the recipe says otherwise. Fully working: this is the generic
 * Webhook lead source.
 */
@Injectable()
export class WebhookRelayConnector implements InboundConnectorType {
  readonly kind = 'webhook_relay' as const;
  readonly implemented = true;
  readonly inbound = true;
  readonly polls = false;

  checkRecipe(recipe: MarketRecipe): ConnectorProblem[] {
    return recipe.connector.type === 'webhook_relay'
      ? []
      : [{ path: 'connector.type', message: 'This is not a webhook relay recipe.' }];
  }

  describeAuth(recipe: MarketRecipe) {
    const auth = recipe.connector.type === 'webhook_relay' ? recipe.connector.auth : 'either';
    return {
      auth,
      tokenHeader: MARKET_HOOK_TOKEN_HEADER,
      signatureHeader: MARKET_HOOK_SIGNATURE_HEADER,
    };
  }

  authenticate(recipe: MarketRecipe, req: InboundRequest, secret: string): boolean {
    const { auth } = this.describeAuth(recipe);
    const byToken = () => tokenMatches(secret, req.headers[MARKET_HOOK_TOKEN_HEADER]);
    const bySignature = () =>
      signatureMatches(secret, req.rawBody, req.headers[MARKET_HOOK_SIGNATURE_HEADER]);
    if (auth === 'token') return byToken();
    if (auth === 'hmac') return bySignature();
    return byToken() || bySignature();
  }

  secretFor(
    _recipe: MarketRecipe,
    _credentials: Record<string, string>,
    connectionSecret: string | null,
  ) {
    return connectionSecret;
  }

  parse(recipe: MarketRecipe, body: unknown) {
    return mapDelivery(recipe, body);
  }

  async test(ctx: ConnectorContext): Promise<ConnectorTestResult> {
    return testSample(ctx);
  }
}

/**
 * Push (a portal posts leads to our address, with its own header and its own mapping): the same door as the relay, driven entirely by the
 * recipe. The portal authenticates with a header token or an HMAC; the secret is one of the recipe's auth fields (the key the admin pastes
 * from the portal) or, when the recipe names none, the secret the platform generated for the connection.
 */
@Injectable()
export class PushConnector implements InboundConnectorType {
  readonly kind = 'push' as const;
  readonly implemented = true;
  readonly inbound = true;
  readonly polls = false;

  checkRecipe(recipe: MarketRecipe): ConnectorProblem[] {
    if (recipe.connector.type !== 'push') {
      return [{ path: 'connector.type', message: 'This is not a push recipe.' }];
    }
    return [];
  }

  describeAuth(recipe: MarketRecipe) {
    const c = recipe.connector;
    if (c.type !== 'push') {
      return {
        auth: 'either' as const,
        tokenHeader: MARKET_HOOK_TOKEN_HEADER,
        signatureHeader: MARKET_HOOK_SIGNATURE_HEADER,
      };
    }
    const byToken = c.auth.scheme === 'header_token';
    return {
      auth: byToken ? ('token' as const) : ('hmac' as const),
      tokenHeader: byToken ? c.auth.header.toLowerCase() : MARKET_HOOK_TOKEN_HEADER,
      signatureHeader: byToken ? MARKET_HOOK_SIGNATURE_HEADER : c.auth.header.toLowerCase(),
    };
  }

  authenticate(recipe: MarketRecipe, req: InboundRequest, secret: string): boolean {
    const d = this.describeAuth(recipe);
    return d.auth === 'token'
      ? tokenMatches(secret, req.headers[d.tokenHeader])
      : signatureMatches(secret, req.rawBody, req.headers[d.signatureHeader]);
  }

  secretFor(
    recipe: MarketRecipe,
    credentials: Record<string, string>,
    connectionSecret: string | null,
  ) {
    const c = recipe.connector;
    const field = c.type === 'push' ? c.auth.credentialField : undefined;
    return field ? (credentials[field] ?? null) : connectionSecret;
  }

  parse(recipe: MarketRecipe, body: unknown) {
    return mapDelivery(recipe, body);
  }

  async test(ctx: ConnectorContext): Promise<ConnectorTestResult> {
    return testSample(ctx);
  }
}
