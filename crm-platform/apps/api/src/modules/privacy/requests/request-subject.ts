import { CryptoService } from '../../../common/crypto/crypto.service';
import type { StoredSubject } from '../engine/subject-resolver';
import type { RequestRow } from './privacy-requests.repository';

/**
 * The person a request is about, as the resolver takes it. A contact or lead that has since been deleted (an erasure already ran, or
 * the CRM deleted it) leaves nothing to resolve from: null, and the caller refuses the action.
 */
export function storedSubjectOf(row: RequestRow, crypto: CryptoService): StoredSubject | null {
  if (row.subjectKind === 'contact') {
    return row.contactId === null ? null : { kind: 'contact', contactId: row.contactId };
  }
  if (row.subjectKind === 'lead') {
    return row.leadId === null ? null : { kind: 'lead', leadId: row.leadId };
  }
  if (row.identifierCipher && (row.identifierKind === 'phone' || row.identifierKind === 'email')) {
    return {
      kind: 'identifier',
      identifierKind: row.identifierKind,
      value: crypto.decrypt(row.identifierCipher),
    };
  }
  return null;
}
