import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, type MailProvider } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import {
  isOAuthDriver,
  isPasswordDriver,
  type MailDriver,
  type OAuthMailDriver,
  type PasswordMailDriver,
} from './mail-driver';

/**
 * The mail providers the platform knows (like `ChannelAdapterRegistry`). A driver registers itself when its module initialises
 * (`onModuleInit`); everything that needs a provider asks here by the mailbox's `provider` value and never names one.
 */
@Injectable()
export class MailDriverRegistry {
  private readonly drivers = new Map<MailProvider, MailDriver>();

  /** Registers a driver; a second driver for the same provider replaces the first (tests do this). */
  register(driver: MailDriver): void {
    this.drivers.set(driver.provider, driver);
  }

  has(provider: string): boolean {
    return this.drivers.has(provider as MailProvider);
  }

  find(provider: string): MailDriver | undefined {
    return this.drivers.get(provider as MailProvider);
  }

  /** The driver of a provider; 422 `MAIL_PROVIDER_UNSUPPORTED` when none is registered. */
  get(provider: string): MailDriver {
    const driver = this.find(provider);
    if (!driver) {
      throw new AppError(
        ERROR_CODES.MAIL_PROVIDER_UNSUPPORTED,
        `The email provider "${provider}" is not available.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return driver;
  }

  /** The driver, which must sign in by popup. */
  oauth(provider: string): OAuthMailDriver {
    const driver = this.get(provider);
    if (!isOAuthDriver(driver)) {
      throw new AppError(
        ERROR_CODES.MAIL_PROVIDER_UNSUPPORTED,
        `${driver.label} is connected with its server settings, not a sign-in.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return driver;
  }

  /** The driver, which must be connected with settings and a password. */
  password(provider: string): PasswordMailDriver {
    const driver = this.get(provider);
    if (!isPasswordDriver(driver)) {
      throw new AppError(
        ERROR_CODES.MAIL_PROVIDER_UNSUPPORTED,
        `${driver.label} is connected with a sign-in, not a password.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return driver;
  }

  /** Every registered driver, in the order the hub offers them. */
  list(): MailDriver[] {
    const order: MailProvider[] = ['google', 'microsoft', 'imap'];
    return [...this.drivers.values()].sort(
      (a, b) => order.indexOf(a.provider) - order.indexOf(b.provider),
    );
  }
}
