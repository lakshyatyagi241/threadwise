'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { OperatorSessionResponse, OperatorSummary } from '@crm/contracts';
import { canEditSection, canRunDangerActions, type OperatorSection } from './operator-role';

interface OperatorState {
  operator: OperatorSummary;
  /** Whether this operator's role may change the given settings section (the API enforces it per section). */
  canEdit: (section: OperatorSection) => boolean;
  /** Only super admins may run the danger-zone actions. */
  canRunDanger: boolean;
  /** A super admin who has not enrolled two-factor authentication yet: the console is locked to the enrolment page. */
  enrolmentRequired: boolean;
}

const OperatorContext = createContext<OperatorState | null>(null);

/** The signed-in operator, fetched once by the (admin) layout and shared with every console page. */
export function OperatorProvider({
  session,
  children,
}: {
  session: OperatorSessionResponse;
  children: ReactNode;
}) {
  const value = useMemo<OperatorState>(
    () => ({
      operator: session.operator,
      canEdit: (section) => canEditSection(session.operator.role, section),
      canRunDanger: canRunDangerActions(session.operator.role),
      enrolmentRequired: session.mfaEnrolmentRequired,
    }),
    [session.operator, session.mfaEnrolmentRequired],
  );
  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>;
}

export function useOperator(): OperatorState {
  const ctx = useContext(OperatorContext);
  if (!ctx) throw new Error('useOperator must be used inside the (admin) layout');
  return ctx;
}

/** True when the signed-in operator may change this settings section. */
export function useCanEdit(section: OperatorSection): boolean {
  return useOperator().canEdit(section);
}
