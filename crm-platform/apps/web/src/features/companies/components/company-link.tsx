'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useCompany } from '../api/companies';

export interface CompanyLinkProps {
  id: string;
  /** The company's name when the caller already has it (a deal carries it). Absent: it is read from the API. */
  name?: string;
  /** What to show instead of the name (a sentence that contains it). */
  children?: ReactNode;
  className?: string;
}

/**
 * A company wherever another screen shows it (the contact page, the deal drawer): a link to its page for someone who may read
 * companies, plain text for someone who may not, and nothing when the name is unknown and cannot be read (WD-CTP-005).
 */
export function CompanyLink({ id, name, children, className }: CompanyLinkProps) {
  const canRead = useCan('record.companies.read');
  const fetched = useCompany(name === undefined && canRead ? id : null);
  const label = children ?? name ?? fetched.data?.name;
  if (!label) return null;
  return canRead ? (
    <Link
      href={`/companies/${id}`}
      dir="auto"
      className={
        className ??
        'font-medium text-brand underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none dark:text-primary'
      }
    >
      {label}
    </Link>
  ) : (
    <span dir="auto" className={className}>
      {label}
    </span>
  );
}
