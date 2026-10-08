import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES, REPORT_DOCUMENT_LIMITS } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';

/** Problems the assistant answers with. Plain messages: the web shows them as they are. */

export const docTooLarge = (): AppError =>
  new AppError(
    ERROR_CODES.REPORT_DOC_TOO_LARGE,
    `The file may not be greater than ${REPORT_DOCUMENT_LIMITS.fileBytes / (1024 * 1024)} MB.`,
    HttpStatus.PAYLOAD_TOO_LARGE,
  );

export const docTypeUnsupported = (ext: string): AppError =>
  new AppError(
    ERROR_CODES.REPORT_DOC_TYPE_UNSUPPORTED,
    ext === 'doc'
      ? 'Legacy .doc files are not supported: re-save as .docx (or export to .pdf) and add it again.'
      : 'Accepted file types: PDF, DOCX, TXT, Markdown, CSV, HTML and JSON.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

export const docUnreadable = (): AppError =>
  new AppError(
    ERROR_CODES.REPORT_DOC_UNREADABLE,
    'Could not read that file: it may be corrupt or password-protected. Try another file.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

export const docNoText = (): AppError =>
  new AppError(
    ERROR_CODES.REPORT_DOC_NO_TEXT,
    'No readable text found. A scanned or image-only PDF has no extractable text: export it with selectable text, or add a text version.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

export const docLimitReached = (): AppError =>
  new AppError(
    ERROR_CODES.REPORT_DOC_LIMIT_REACHED,
    `The library holds at most ${REPORT_DOCUMENT_LIMITS.maxDocuments} documents. Remove one to add another.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

export const aiKeyMissing = (workspace: boolean): AppError =>
  new AppError(
    ERROR_CODES.REPORT_AI_KEY_MISSING,
    workspace
      ? 'Add an AI key in Settings to use the report assistant.'
      : 'Add an AI provider key under AI keys to use the report assistant.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

export const aiProviderUnsupported = (): AppError =>
  new AppError(
    ERROR_CODES.REPORT_AI_PROVIDER_UNSUPPORTED,
    'The report assistant needs an Anthropic, OpenAI, Google Gemini or OpenRouter key. Add one in Settings.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
