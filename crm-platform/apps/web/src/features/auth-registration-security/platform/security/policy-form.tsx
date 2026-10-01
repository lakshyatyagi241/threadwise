'use client';

import { createContext, useContext } from 'react';
import type { SecurityPolicy } from '@crm/contracts';
import type { EnforcementRow } from '../lib/enforcement';
import type { PolicyDraft } from '../lib/policy-draft';

export const SECURITY_NS = 'auth-registration-security.platform.security';
export const fieldId = (key: string) => `policy-${key}`;

export interface PolicyFormState {
  /** The stored policy: placeholders and "your IP" hints read from it. */
  base: SecurityPolicy;
  draft: PolicyDraft;
  setField: <K extends keyof PolicyDraft>(key: K, value: PolicyDraft[K]) => void;
  /** The user may look but not change (auditors). */
  readOnly: boolean;
  matrix: readonly EnforcementRow[];
  yourIp: string | null;
  /** Rendered error text per control, from client checks and from the server's field errors. */
  errors: Partial<Record<keyof SecurityPolicy, string>>;
}

const PolicyFormContext = createContext<PolicyFormState | null>(null);

export const PolicyFormProvider = PolicyFormContext.Provider;

export function usePolicyForm(): PolicyFormState {
  const ctx = useContext(PolicyFormContext);
  if (!ctx) throw new Error('usePolicyForm must be used inside the Security Center form');
  return ctx;
}
