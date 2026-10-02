import { Injectable } from '@nestjs/common';
import {
  appendFooterToBody,
  brandEmail,
  brandName,
  brandToken,
  resolveBrandingFooter,
  webhookHeaderNames,
} from '@crm/contracts';
import { SettingsService } from './settings.service';

/**
 * The brand as the rest of the product asks for it (TW-SET-011, 012): name, tokens, role mailboxes, webhook header names
 * and the outbound message footer. Reads go through the settings snapshot (a few seconds old at most), so a re-brand shows
 * up without a restart. Other domains import this through the module barrel.
 */
@Injectable()
export class BrandingService {
  constructor(private readonly settings: SettingsService) {}

  async name(): Promise<string> {
    return brandName((await this.settings.values('general')).appName);
  }

  async token(n = 6): Promise<string> {
    return brandToken(await this.name(), n);
  }

  /** `prefix@domain` or the saved role mailbox (`site.email_<prefix>`), see `brandEmail`. */
  async email(prefix: string, requestHost?: string): Promise<string> {
    const [g, site] = await Promise.all([
      this.settings.values('general'),
      this.settings.values('site'),
    ]);
    return brandEmail(prefix, {
      roleEmails: {
        general: site.emailGeneral,
        support: site.emailSupport,
        sales: site.emailSales,
        security: site.emailSecurity,
        careers: site.emailCareers,
      },
      supportEmail: site.emailSupport || g.supportEmail,
      requestHost,
      appUrl: g.appUrl,
    });
  }

  async webhookHeaders() {
    return webhookHeaderNames(await this.name());
  }

  /** The platform default footer, or null when the admin cleared it. */
  async platformFooter(): Promise<string | null> {
    return resolveBrandingFooter({
      platformFooter: (await this.settings.values('general')).platformFooter,
    });
  }

  /**
   * The footer for one workspace's outbound message: its own when the plan has `remove_branding`, the platform default
   * otherwise. The caller supplies the two workspace facts (the plan gate and the saved footer live in other domains).
   */
  async footerFor(ws: {
    hasRemoveBranding: boolean;
    footer: string | null;
  }): Promise<string | null> {
    return resolveBrandingFooter({
      platformFooter: (await this.settings.values('general')).platformFooter,
      workspaceFooter: ws.footer,
      hasRemoveBranding: ws.hasRemoveBranding,
    });
  }

  /** Plain-text body with the footer appended once (templates must not go through this). */
  async decorate(
    body: string,
    ws: { hasRemoveBranding: boolean; footer: string | null },
  ): Promise<string> {
    return appendFooterToBody(body, await this.footerFor(ws));
  }
}
