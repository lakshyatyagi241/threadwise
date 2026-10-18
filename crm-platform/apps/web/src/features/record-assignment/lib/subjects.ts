import {
  ASSIGNMENT_ORIGINS,
  ASSIGNMENT_SUBJECTS,
  CONTACT_ASSIGNMENT_STRATEGIES,
  type AssignmentSubject,
  type ContactAssignmentStrategy,
} from '@crm/contracts';

/** The modules a rule can be about, in the order of the tabs. */
export const SUBJECTS: readonly AssignmentSubject[] = ASSIGNMENT_SUBJECTS;

/** The methods in the order the select lists them (round robin is the default). */
export const STRATEGIES: readonly ContactAssignmentStrategy[] = [
  'round_robin',
  'least_busy',
  'fixed',
] satisfies readonly (typeof CONTACT_ASSIGNMENT_STRATEGIES)[number][];

export const ORIGINS = ASSIGNMENT_ORIGINS;

export const isSubject = (v: string | null | undefined): v is AssignmentSubject =>
  v !== null && v !== undefined && (SUBJECTS as readonly string[]).includes(v);

/** The page of a record, for the run log. */
export function recordHref(subject: AssignmentSubject, id: string): string {
  const id_ = encodeURIComponent(id);
  return subject === 'contact'
    ? `/contacts/${id_}`
    : subject === 'company'
      ? `/companies/${id_}`
      : `/deals/${id_}`;
}
