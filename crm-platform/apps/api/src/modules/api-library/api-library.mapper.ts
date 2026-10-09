import {
  API_LIBRARY_SECRET_MASK,
  type ApiLibraryDetail,
  type ApiLibraryItem,
  type ApiLibraryLogDetail,
  type ApiLibraryLogItem,
  type ApiLibraryOption,
} from '@crm/contracts';
import type { ApiRow } from './api-library.repository';
import type { LogRow } from './api-library-logs.repository';

export function toItem(row: ApiRow): ApiLibraryItem {
  return {
    id: row.uuid,
    name: row.name,
    method: row.method,
    url: row.url,
    payloadType: row.payloadType,
    hasFunction: row.functionCode !== null && row.functionCode.trim() !== '',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rowVersion: row.rowVersion,
  };
}

/**
 * The edit form. The stored value of a secret header is encrypted and is never sent: it reads as the mask, and an update that sends the
 * mask back keeps the stored value (see ApiLibraryService.update).
 */
export function toDetail(row: ApiRow): ApiLibraryDetail {
  return {
    ...toItem(row),
    variables: row.variables.map((v) => ({
      name: v.name,
      source: v.source as ApiLibraryDetail['variables'][number]['source'],
      defaultValue: v.defaultValue,
    })),
    headers: row.headers.map((h) => ({
      key: h.key,
      value: h.secret ? API_LIBRARY_SECRET_MASK : h.value,
      secret: h.secret,
    })),
    body: row.body,
    functionCode: row.functionCode,
    mapping: row.mappingConfig,
    responseVariables: row.responseVariables,
    createdById: row.createdByUuid,
  };
}

export function toOption(row: ApiRow): ApiLibraryOption {
  return {
    id: row.uuid,
    name: row.name,
    method: row.method,
    variables: toDetail(row).variables,
    responseVariables: row.responseVariables,
  };
}

export function toLogItem(row: LogRow): ApiLibraryLogItem {
  return {
    id: row.uuid,
    apiId: row.apiUuid,
    apiName: row.apiName,
    source: row.source,
    method: row.method,
    url: row.url,
    ok: row.ok,
    statusCode: row.statusCode,
    durationMs: row.durationMs,
    errorKind: row.errorKind,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toLogDetail(row: LogRow): ApiLibraryLogDetail {
  return {
    ...toLogItem(row),
    requestHeaders: row.requestHeaders,
    requestBody: row.requestBody,
    responseHeaders: row.responseHeaders,
    responseBody: row.responseBody,
    responseTruncated: row.responseTruncated,
    context: {
      contactId: row.contactUuid,
      flowId: row.flowUuid,
      flowRunId: row.flowRunUuid,
      flowNodeId: row.flowNodeId,
      userId: row.userUuid,
    },
  };
}

/**
 * The envelope of a numbered page: `page.page` is the page returned, and the totals are in `page` and at the top level. A page beyond
 * the last is an empty list with the real total, not an error.
 */
export function numberedPage<T>(items: T[], total: number, page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    data: items,
    page: {
      nextCursor: null,
      hasMore: page < totalPages,
      limit: pageSize,
      total,
      page,
      pageSize,
      totalPages,
    },
    total,
    pageSize,
    totalPages,
  };
}
