import { Injectable } from '@nestjs/common';
import type { MarketRecipe } from '@crm/contracts';
import type {
  ConnectorContext,
  ConnectorProblem,
  ConnectorTestResult,
  ConnectorType,
} from './connector.port';

const NOT_AVAILABLE: ConnectorTestResult = {
  ok: false,
  code: 'not_available',
  message: 'This connector type is not available yet.',
};

/**
 * OAuth (the admin signs in, we keep the refresh token sealed): the recipe schema and its address checks exist, the flow does not. It is
 * built with the first OAuth integration that needs it, on the pattern of the Google Calendar connection (signed state, sealed refresh
 * token, a `needs_reauth` health when the grant is refused). Registered so a recipe of this type is validated and stored, but not
 * `implemented`: it cannot be published.
 */
@Injectable()
export class OAuthConnector implements ConnectorType {
  readonly kind = 'oauth' as const;
  readonly implemented = false;
  readonly inbound = false;
  readonly polls = false;

  checkRecipe(recipe: MarketRecipe): ConnectorProblem[] {
    return recipe.connector.type === 'oauth'
      ? []
      : [{ path: 'connector.type', message: 'This is not an OAuth recipe.' }];
  }

  async test(_ctx: ConnectorContext): Promise<ConnectorTestResult> {
    return NOT_AVAILABLE;
  }
}

/**
 * Email parse (a portal sends lead alerts by email; a template extracts name, phone and requirement): depends on the Email channel
 * (docs/specs/email-channel-and-social-leads.md), which supplies the mailbox and the plain-text body. The recipe's parser rules are
 * validated and stored; running them is built with that channel. Registered, not `implemented`.
 */
@Injectable()
export class EmailParseConnector implements ConnectorType {
  readonly kind = 'email_parse' as const;
  readonly implemented = false;
  readonly inbound = false;
  readonly polls = false;

  checkRecipe(recipe: MarketRecipe): ConnectorProblem[] {
    const c = recipe.connector;
    if (c.type !== 'email_parse')
      return [{ path: 'connector.type', message: 'This is not an email-parse recipe.' }];
    const problems: ConnectorProblem[] = [];
    if (!c.rules.some((r) => r.required)) {
      problems.push({
        path: 'connector.rules',
        message:
          'Mark at least one rule required (usually the phone or the email), or every alert becomes a lead.',
      });
    }
    return problems;
  }

  async test(_ctx: ConnectorContext): Promise<ConnectorTestResult> {
    return NOT_AVAILABLE;
  }
}
