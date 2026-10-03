import type { MarketRecipe } from '@crm/contracts';
import {
  assertPublicUrl,
  UnsafeProviderUrlError,
  type PublicUrlOptions,
} from '../whatsapp-cloud-api-waba/provider-url-guard';

/**
 * Every address a recipe makes the platform call: a pull connector's base URL, an OAuth connector's authorize and token URLs. The shape
 * (https, a public DNS name, no credentials) is checked by the recipe schema; this checks where each name POINTS, with the same guard the
 * WhatsApp provider registry uses, so a recipe typed by an operator or a partner is never a way into the platform's own network (the
 * metadata service, the database, an admin port).
 *
 * It runs when a version is saved and again right before every outbound call (resolve, then connect, is not atomic; a rebinding DNS server
 * could answer differently the second time, which the https-only rule limits: a rebound private address cannot present a certificate for
 * the recipe's host name).
 */
export function recipeUrls(recipe: MarketRecipe): string[] {
  const c = recipe.connector;
  switch (c.type) {
    case 'pull':
      return [c.request.baseUrl];
    case 'oauth':
      return [c.authorizeUrl, c.tokenUrl];
    default:
      return [];
  }
}

export class RecipeUrlRefusedError extends Error {
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(reason);
    this.name = 'RecipeUrlRefusedError';
  }
}

/** Throws RecipeUrlRefusedError for the first address that is refused. */
export async function assertRecipeUrlsPublic(
  recipe: MarketRecipe,
  options: PublicUrlOptions = {},
): Promise<void> {
  for (const url of recipeUrls(recipe)) {
    try {
      await assertPublicUrl(url, options);
    } catch (e) {
      if (e instanceof UnsafeProviderUrlError) throw new RecipeUrlRefusedError(url, e.reason);
      throw e;
    }
  }
}
