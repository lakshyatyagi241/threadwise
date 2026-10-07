import {
  ExecutionContext,
  Injectable,
  PayloadTooLargeException,
  type CallHandler,
  type NestInterceptor,
  type Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { V1_MEDIA_MAX_BYTES } from '@crm/contracts';
import { validationFailed } from './messaging-errors';

/**
 * One multipart file under `field`, at most 16 MB (WaDesk's cap for every kind). A file over the cap is a validation failure on that field
 * (`error.details.<field>`), as WaDesk answered, and not the bare 413 multer raises by default.
 */
export function v1FileUpload(field: string): Type<NestInterceptor> {
  const Inner = FileInterceptor(field, { limits: { fileSize: V1_MEDIA_MAX_BYTES, files: 1 } });
  @Injectable()
  class V1FileUpload extends Inner {
    override async intercept(
      context: ExecutionContext,
      next: CallHandler,
    ): Promise<Observable<unknown>> {
      try {
        return await super.intercept(context, next);
      } catch (err) {
        if (err instanceof PayloadTooLargeException) {
          throw validationFailed(
            field,
            `The ${field} must not be greater than ${V1_MEDIA_MAX_BYTES / 1024} kilobytes.`,
          );
        }
        throw err;
      }
    }
  }
  return V1FileUpload;
}
