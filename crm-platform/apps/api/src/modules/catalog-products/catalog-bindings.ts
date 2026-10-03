import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import type { CatalogBinding } from '../../infra/providers/catalog-products/catalog-provider.port';
import type { CatalogRow } from './catalogs.repository';

/** The one place the stored access token is decrypted; the result goes to a provider call and nowhere else. */
@Injectable()
export class CatalogBindings {
  constructor(private readonly crypto: CryptoService) {}

  of(row: CatalogRow): CatalogBinding {
    if (!row.accessTokenEnc) {
      throw new AppError(
        ERROR_CODES.CAT_PROVIDER_FAILED,
        'The catalog has no stored access token. Connect it again.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    let accessToken: string;
    try {
      accessToken = this.crypto.decrypt(row.accessTokenEnc);
    } catch {
      throw new AppError(
        ERROR_CODES.CAT_PROVIDER_FAILED,
        'The stored access token could not be read. Connect the catalog again.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return {
      provider: row.provider,
      catalogId: row.catalogId,
      wabaId: row.wabaId,
      phoneNumberId: row.phoneNumberId,
      accessToken,
    };
  }

  encrypt(token: string): string {
    return this.crypto.encrypt(token);
  }
}
